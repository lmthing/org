import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Session } from '../session/session.js';
import { mockScript } from './mock-provider.js';
import {
  mockFromTrace,
  mockFromExchanges,
  parseTraceExchanges,
  requestFingerprint,
} from './trace-replay.js';
import type { RenderHost, SessionDeps } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { TraceEvent } from '../sandbox/trace.js';

/**
 * Trace replay (IMPROVEMENTS 5.1). Two halves:
 *
 *  - **unit** — parsing (pairing, skipping, unanswered requests, both on-disk
 *    shapes), the exhaustion error, fingerprint matching;
 *  - **round-trip** — record a real scripted session with `--trace`-style tracing
 *    on, then replay that trace file through a FRESH session and assert the two
 *    runs are statement-for-statement and display-for-display identical.
 *
 * The round-trip is the load-bearing one: it proves the recorded `llm_response`
 * texts are sufficient to re-drive the host pipeline (boundary carving, yield
 * suspend/abort, host-side binding, the next turn's VARIABLES block) to the same
 * end state, with the model out of the loop entirely.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
/** Set LM_UPDATE_FIXTURES=1 to re-harvest the committed fixture from a live re-record. */
const UPDATE_FIXTURES = process.env['LM_UPDATE_FIXTURES'] === '1';

const tmpDirs: string[] = [];

async function makeSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-replay-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'You are a test agent.\n', 'utf8');
  return dir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

interface RunResult {
  displays: unknown[];
  statements: string[];
  responses: string[];
  traceFile: string;
  error?: Error;
}

/** Drive a Session with `streamFn`, tracing to a file; read the trace back. */
async function runSession(streamFn: SessionDeps['streamFn'], messages: string[]): Promise<RunResult> {
  const spaceDir = await makeSpace();
  const traceFile = join(spaceDir, 'trace.ndjson');
  const displays: unknown[] = [];
  const host: RenderHost = {
    display: (d) => { displays.push(d); },
    ask: async () => undefined,
    log: () => {},
  };
  const session = new Session(
    { spaceDir, agentSlug: 'default', modelAlias: 'mock', renderHost: host, traceFile, systemSpaceDirs: [] },
    { streamFn },
  );
  let error: Error | undefined;
  try {
    const [first, ...rest] = messages;
    await session.start(first!);
    for (const m of rest) await session.continue(m);
  } catch (e) {
    error = e as Error;
  }
  session.dispose();

  let events: TraceEvent[] = [];
  try {
    const raw = await readFile(traceFile, 'utf8');
    events = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as TraceEvent);
  } catch { /* no trace */ }
  return {
    displays,
    statements: events.filter((e) => e.type === 'statement').map((e) => e.code),
    responses: events.filter((e) => e.type === 'llm_response').map((e) => e.text),
    traceFile,
    ...(error ? { error } : {}),
  };
}

const streamOpts = (user: string): StreamOpts => ({ system: 'sys', messages: [{ role: 'user', content: user }] });

async function drain(s: StreamSession): Promise<string> {
  let out = '';
  for await (const c of s.textStream) out += c;
  return out;
}

const ndjson = (...events: unknown[]): string => events.map((e) => JSON.stringify(e)).join('\n') + '\n';

// ---------------------------------------------------------------------------
// parseTraceExchanges
// ---------------------------------------------------------------------------

describe('parseTraceExchanges', () => {
  it('pairs each llm_request with its llm_response and skips every other event', () => {
    const raw = ndjson(
      { ts: 1, type: 'session_start', sessionId: 's', spaceDir: '/x', agentSlug: 'a' },
      { ts: 2, type: 'llm_request', context: 'session', nodeId: 'n1', system: 'sys', messages: [{ role: 'user', content: 'go' }], model: 'M' },
      { ts: 3, type: 'statement', context: 'session', nodeId: 'n1', code: 'display("a");' },
      { ts: 4, type: 'yield', context: 'session', nodeId: 'n1', kind: 'sleep', args: {} },
      { ts: 5, type: 'llm_response', context: 'session', nodeId: 'n1', attempt: 0, text: 'display("a");' },
      { ts: 6, type: 'turn_end', context: 'session', nodeId: 'n1', reason: 'done' },
    );
    const ex = parseTraceExchanges(raw);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({
      index: 0, context: 'session', nodeId: 'n1', model: 'M', attempt: 0,
      text: 'display("a");', unanswered: false,
    });
    expect(ex[0]!.messages).toEqual([{ role: 'user', content: 'go' }]);
  });

  it('pairs within a node, so interleaved fork calls do not cross-contaminate', () => {
    const raw = ndjson(
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 's1', system: 'a', messages: [{ role: 'user', content: 'go' }] },
      { ts: 2, type: 'llm_request', context: 'fork:explore', nodeId: 'f1', system: 'b', messages: [{ role: 'user', content: 'explore' }] },
      { ts: 3, type: 'llm_response', context: 'fork:explore', nodeId: 'f1', attempt: 0, text: 'FORK-TEXT' },
      { ts: 4, type: 'llm_response', context: 'session', nodeId: 's1', attempt: 0, text: 'SESSION-TEXT' },
    );
    const ex = parseTraceExchanges(raw);
    expect(ex.map((e) => [e.context, e.text])).toEqual([
      ['session', 'SESSION-TEXT'],
      ['fork:explore', 'FORK-TEXT'],
    ]);
  });

  it('keeps a request with no recorded response as an empty, unanswered exchange', () => {
    // Two requests on one node with a single response: the FIRST produced nothing
    // usable (aborted / no parsed statements), so the response belongs to the second.
    const raw = ndjson(
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n1', system: 's', messages: [{ role: 'user', content: 'go' }] },
      { ts: 2, type: 'llm_request', context: 'session', nodeId: 'n1', system: 's', messages: [{ role: 'user', content: 'retry' }] },
      { ts: 3, type: 'llm_response', context: 'session', nodeId: 'n1', attempt: 1, text: 'display("ok");' },
    );
    const ex = parseTraceExchanges(raw);
    expect(ex.map((e) => [e.text, e.unanswered])).toEqual([
      ['', true],
      ['display("ok");', false],
    ]);
  });

  it('replays a PARTIAL response verbatim (the recorded text is what the host saw)', () => {
    // A stream aborted at a yield records only the statements up to the yield.
    const raw = ndjson(
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n1', system: 's', messages: [{ role: 'user', content: 'go' }] },
      { ts: 2, type: 'llm_response', context: 'session', nodeId: 'n1', attempt: 0, text: 'display("a");\nconst v = await sleep("1ms");' },
    );
    expect(parseTraceExchanges(raw)[0]!.text).toBe('display("a");\nconst v = await sleep("1ms");');
  });

  it('accepts a persisted trace.json array — bare events and {seq,event} envelopes', () => {
    const events = [
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n1', system: 's', messages: [{ role: 'user', content: 'go' }] },
      { ts: 2, type: 'llm_response', context: 'session', nodeId: 'n1', attempt: 0, text: 'display("x");' },
    ];
    expect(parseTraceExchanges(JSON.stringify(events))[0]!.text).toBe('display("x");');
    const enveloped = events.map((event, i) => ({ seq: i + 1, event }));
    expect(parseTraceExchanges(JSON.stringify(enveloped))[0]!.text).toBe('display("x");');
  });

  it('tolerates a truncated final line (the tracer appends; a killed process leaves one)', () => {
    const raw = ndjson(
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n1', system: 's', messages: [{ role: 'user', content: 'go' }] },
      { ts: 2, type: 'llm_response', context: 'session', nodeId: 'n1', attempt: 0, text: 'display("x");' },
    ) + '{"ts":3,"type":"llm_res';
    expect(parseTraceExchanges(raw)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mockFromTrace — file handling + exhaustion
// ---------------------------------------------------------------------------

describe('mockFromTrace', () => {
  it('throws naming the path when the file is missing', () => {
    expect(() => mockFromTrace(join(tmpdir(), 'no-such-trace-xyz.ndjson'))).toThrow(/cannot read trace file/);
  });

  it('throws when the trace has no llm_ events at all', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lmthing-replay-empty-'));
    tmpDirs.push(dir);
    const p = join(dir, 'trace.ndjson');
    await writeFile(p, ndjson({ ts: 1, type: 'turn_end', context: 'session', reason: 'done' }), 'utf8');
    expect(() => mockFromTrace(p)).toThrow(/no llm_request\/llm_response events/);
  });

  it('replays recorded responses in order (sequential, the default)', async () => {
    const fn = mockFromExchanges(parseTraceExchanges(ndjson(
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'one' }] },
      { ts: 2, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 0, text: 'FIRST' },
      { ts: 3, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'two' }] },
      { ts: 4, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 0, text: 'SECOND' },
    )));
    // The incoming prompts are ignored in sequential mode — order is the contract.
    expect(await drain(await fn(streamOpts('anything')))).toBe('FIRST');
    expect(await drain(await fn(streamOpts('anything')))).toBe('SECOND');
  });

  it("replays the recorded finishReason per call — a 'length' cut stays a truncation", async () => {
    const fn = mockFromExchanges(parseTraceExchanges(ndjson(
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'one' }] },
      { ts: 2, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 0, text: 'CUT', finishReason: 'length' },
      { ts: 3, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'two' }] },
      { ts: 4, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 0, text: 'WHOLE', finishReason: 'stop' },
    )));
    const first = await fn(streamOpts('one'));
    expect(first.finishReason).toBeUndefined(); // not readable until the stream ends
    await drain(first);
    expect(first.finishReason).toBe('length');

    const second = await fn(streamOpts('two'));
    await drain(second);
    expect(second.finishReason).toBe('stop');
  });

  it('reports no finishReason after abort() — no finish part arrives on a cut stream', async () => {
    const fn = mockFromExchanges(parseTraceExchanges(ndjson(
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'one' }] },
      { ts: 2, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 0, text: 'CUT', finishReason: 'length' },
    )));
    const s = await fn(streamOpts('one'));
    s.abort();
    await drain(s);
    expect(s.finishReason).toBeUndefined();
  });

  it('fails LOUDLY when the replay outruns the recording, naming recorded vs requested', async () => {
    const fn = mockFromExchanges(parseTraceExchanges(ndjson(
      { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'one' }] },
      { ts: 2, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 0, text: 'FIRST' },
    )), { label: 'run.ndjson' });
    await fn(streamOpts('one'));
    await expect(fn(streamOpts('surprise extra turn'))).rejects.toThrow(
      /recorded responses exhausted[\s\S]*recorded 1 model call\(s\); the replay requested #2[\s\S]*surprise extra turn/,
    );
  });
});

// ---------------------------------------------------------------------------
// fingerprint mode
// ---------------------------------------------------------------------------

describe("mockFromTrace mode: 'fingerprint'", () => {
  const trace = ndjson(
    { ts: 1, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'ASK A' }] },
    { ts: 2, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 0, text: 'ANSWER-A' },
    { ts: 3, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'ASK B' }] },
    { ts: 4, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 0, text: 'ANSWER-B' },
    { ts: 5, type: 'llm_request', context: 'session', nodeId: 'n', system: 's', messages: [{ role: 'user', content: 'ASK A' }] },
    { ts: 6, type: 'llm_response', context: 'session', nodeId: 'n', attempt: 1, text: 'ANSWER-A2' },
  );
  const build = (): ((o: StreamOpts) => Promise<StreamSession>) =>
    mockFromExchanges(parseTraceExchanges(trace), { mode: 'fingerprint', label: 'run.ndjson' });

  it('matches by last user message, so a REORDERED replay still gets the right answer', async () => {
    const fn = build();
    // B first — sequential would have returned ANSWER-A here.
    expect(await drain(await fn(streamOpts('ASK B')))).toBe('ANSWER-B');
    expect(await drain(await fn(streamOpts('ASK A')))).toBe('ANSWER-A');
  });

  it('serves repeats of the same prompt in recorded order (retries)', async () => {
    const fn = build();
    expect(await drain(await fn(streamOpts('ASK A')))).toBe('ANSWER-A');
    expect(await drain(await fn(streamOpts('ASK A')))).toBe('ANSWER-A2');
  });

  it('ignores the system block and earlier messages, and normalizes whitespace', async () => {
    const fn = build();
    const got = await drain(await fn({
      system: 'a COMPLETELY different system block',
      messages: [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'x' }, { role: 'user', content: '  ASK   A  ' }],
    }));
    expect(got).toBe('ANSWER-A');
  });

  it('throws when the replay asks something the recording never asked', async () => {
    await expect(build()(streamOpts('ASK C'))).rejects.toThrow(/no recorded request matches[\s\S]*ASK C/);
  });

  it('throws when one prompt is asked more times than it was recorded', async () => {
    const fn = build();
    await fn(streamOpts('ASK B'));
    await expect(fn(streamOpts('ASK B'))).rejects.toThrow(
      /exhausted for this prompt[\s\S]*recorded 1 response\(s\) for it; the replay asked 2 time\(s\)/,
    );
  });

  it('requestFingerprint picks the last USER message', () => {
    expect(requestFingerprint({ messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ignored' },
      { role: 'user', content: 'VARIABLES\nx = 1' },
    ] })).toBe('VARIABLES x = 1');
  });
});

// ---------------------------------------------------------------------------
// Round trip: record a real session, replay its trace, compare
// ---------------------------------------------------------------------------

/** A scripted run that exercises a yield (stream abort mid-turn), the resumed
 *  continuation turn, and a second user turn. */
const SCRIPT = [
  'display("a");\nawait sleep("1ms");',
  'display("b");',
  'display("c");',
];
const MESSAGES = ['go', 'more'];

describe('round trip: record → replay', () => {
  it('a replayed trace reproduces the recorded statements, displays and responses', async () => {
    const recorded = await runSession(mockScript(SCRIPT), MESSAGES);
    expect(recorded.error).toBeUndefined();
    expect(recorded.displays).toEqual(['a', 'b', 'c']);
    // Sanity: the recording really did abort a stream at the yield — the first
    // response stops at the sleep() statement, mid-script.
    expect(recorded.responses).toHaveLength(3);
    expect(recorded.responses[0]).toContain('sleep');

    const replayed = await runSession(mockFromTrace(recorded.traceFile), MESSAGES);
    expect(replayed.error).toBeUndefined();
    expect(replayed.displays).toEqual(recorded.displays);
    expect(replayed.statements).toEqual(recorded.statements);
    expect(replayed.responses).toEqual(recorded.responses);

    // A replay is itself recordable: replaying the REPLAY's trace is a fixed point.
    const again = await runSession(mockFromTrace(replayed.traceFile), MESSAGES);
    expect(again.statements).toEqual(recorded.statements);

    if (UPDATE_FIXTURES) {
      await mkdir(FIXTURES, { recursive: true });
      await copyFile(recorded.traceFile, join(FIXTURES, 'hello-yield.trace.ndjson'));
    }
  }, 60_000);

  it('the same trace replays under fingerprint mode (order-independent)', async () => {
    const recorded = await runSession(mockScript(SCRIPT), MESSAGES);
    const replayed = await runSession(mockFromTrace(recorded.traceFile, { mode: 'fingerprint' }), MESSAGES);
    expect(replayed.error).toBeUndefined();
    expect(replayed.statements).toEqual(recorded.statements);
    expect(replayed.displays).toEqual(recorded.displays);
  }, 60_000);

  it('replays the committed fixture trace through a fresh session', async () => {
    const fixture = join(FIXTURES, 'hello-yield.trace.ndjson');
    const r = await runSession(mockFromTrace(fixture), MESSAGES);
    expect(r.error).toBeUndefined();
    expect(r.displays).toEqual(['a', 'b', 'c']);
  }, 60_000);
});

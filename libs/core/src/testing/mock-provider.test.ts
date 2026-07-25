import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockStreamFn, mockScript, mockMatch } from './mock-provider.js';
import { Session } from '../session/session.js';
import type { RenderHost, SessionDeps } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';

// --- helpers ---------------------------------------------------------------

async function drainChunks(s: StreamSession): Promise<string[]> {
  const out: string[] = [];
  for await (const c of s.textStream) out.push(c);
  return out;
}

const opts = (system: string, user: string): StreamOpts => ({
  system,
  messages: [{ role: 'user', content: user }],
});

const tmpDirs: string[] = [];

/** Minimal one-agent space on disk; no functions, system spaces disabled. */
async function makeSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-mock-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'You are a test agent.\n', 'utf8');
  return dir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

// --- createMockStreamFn ----------------------------------------------------

describe('createMockStreamFn', () => {
  it('emits a whole string as one chunk', async () => {
    const fn = createMockStreamFn(() => 'const x = 1;');
    expect(await drainChunks(await fn(opts('s', 'u')))).toEqual(['const x = 1;']);
  });

  it('emits a string[] as a sequence of chunks (filtering empties)', async () => {
    const fn = createMockStreamFn(() => ['a', '', 'b']);
    expect(await drainChunks(await fn(opts('s', 'u')))).toEqual(['a', 'b']);
  });

  it('delegates to a returned AsyncIterable', async () => {
    async function* g() { yield 'p'; yield 'q'; }
    const fn = createMockStreamFn(() => g());
    expect(await drainChunks(await fn(opts('s', 'u')))).toEqual(['p', 'q']);
  });

  it('increments callIndex per call', async () => {
    const seen: number[] = [];
    const fn = createMockStreamFn((_o, { callIndex }) => { seen.push(callIndex); return ''; });
    await fn(opts('s', 'u'));
    await fn(opts('s', 'u'));
    await fn(opts('s', 'u'));
    expect(seen).toEqual([0, 1, 2]);
  });

  it('abort() stops the stream mid-flight without unhandled rejections', async () => {
    const fn = createMockStreamFn(() => ['one', 'two', 'three', 'four']);
    const session = await fn(opts('s', 'u'));
    const got: string[] = [];
    for await (const c of session.textStream) {
      got.push(c);
      if (got.length === 2) session.abort();
    }
    expect(got).toEqual(['one', 'two']); // stopped after abort, never reached three/four
  });
});

// --- mockMatch -------------------------------------------------------------

describe('mockMatch', () => {
  it('routes by RegExp on the combined system+messages text', async () => {
    const fn = mockMatch(
      [{ when: /ROLE: explore/, respond: () => 'display("from fork");' }],
      () => 'display("from orchestrator");',
    );
    // A fork carries its role preamble in the system block.
    expect(await drainChunks(await fn(opts('ROLE: explore\nread-only', 'do the thing'))))
      .toEqual(['display("from fork");']);
    // The main loop hits the fallback.
    expect(await drainChunks(await fn(opts('you are the orchestrator', 'do the thing'))))
      .toEqual(['display("from orchestrator");']);
  });

  it('supports a predicate `when` over raw StreamOpts', async () => {
    const fn = mockMatch(
      [{ when: (o) => o.messages.some((m) => m.content.includes('candidate.ts')), respond: () => 'verifier-feedback-path;' }],
      () => 'default-path;',
    );
    expect(await drainChunks(await fn(opts('s', 'write work/candidate.ts'))))
      .toEqual(['verifier-feedback-path;']);
    expect(await drainChunks(await fn(opts('s', 'something else'))))
      .toEqual(['default-path;']);
  });

  it('first matching rule wins', async () => {
    const fn = mockMatch([
      { when: /x/, respond: () => 'first;' },
      { when: /x/, respond: () => 'second;' },
    ]);
    expect(await drainChunks(await fn(opts('x', 'x')))).toEqual(['first;']);
  });

  it('throws when nothing matches and no fallback is given', async () => {
    const fn = mockMatch([{ when: /never/, respond: () => 'x;' }]);
    await expect(fn(opts('s', 'u'))).rejects.toThrow(/no rule matched/);
  });
});

// --- integration: mockScript drives a real Session ------------------------

describe('mockScript drives a real Session', () => {
  it('evaluates scripted statements in order across yields and continue() turns, ending on ""', async () => {
    const displayed: unknown[] = [];
    const renderHost: RenderHost = {
      display: (d) => { displayed.push(d); },
      ask: async () => undefined,
      log: () => {},
    };

    // call0: display "a", then sleep() yields → resume; call1: display "b" (turn ends, no yield).
    // call2: display "c" (second message). call3+: "" ends the loop.
    const deps: SessionDeps = {
      streamFn: mockScript([
        'display("a");\nawait sleep("1ms");',
        'display("b");',
        'display("c");',
      ]),
    };

    const spaceDir = await makeSpace();
    const session = new Session(
      { spaceDir, agentSlug: 'default', modelAlias: 'mock', renderHost, systemSpaceDirs: [] },
      deps,
    );

    await session.start('go');
    expect(displayed).toEqual(['a', 'b']); // ordered across the sleep yield + continuation turn

    await session.continue('more');
    expect(displayed).toEqual(['a', 'b', 'c']);

    // Queue exhausted → mockScript emits "" → the loop ends cleanly with no statements.
    await session.continue('again');
    expect(displayed).toEqual(['a', 'b', 'c']); // nothing new; "" terminated the turn

    session.dispose();
  });
});

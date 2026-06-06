import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Session } from '../session/session.js';
import { BudgetExceededError, type BudgetLimits } from '../eval/budget.js';
import { createMockStreamFn, mockMatch } from './mock-provider.js';
import type { RenderHost, SessionDeps } from '../session/types.js';
import type { TraceEvent } from '../sandbox/trace.js';

// system-spaces live at packages/core/system-spaces (not under src/), so resolve
// them manually the way the other system-function tests do — defaultSystemSpaceDirs()
// assumes the dist/ layout and would point at a nonexistent dir when run from src.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_SPACES_ROOT = join(__dirname, '..', '..', 'system-spaces');

/**
 * Integration tests that drive a REAL Session with the scripted mock provider —
 * the keyless, deterministic counterpart to scripts/live-test.sh. They cover the
 * features added in the recent commits end-to-end through the turn loop:
 *   - budget guardrails (episode / tool-call / wall-clock / fork-depth)
 *   - the progress() global
 *   - the solve escalation ladder (verifyCondition, so no tsc spawn)
 *   - per-role fork models recorded on the llm_request trace
 *   - the session-observable bug fixes (process.exit, let-propagation, execShell
 *     exitCode, grep path-not-found)
 */

const tmpDirs: string[] = [];

/** Minimal one-agent space on disk (no functions). */
async function makeSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-mocksess-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'You are a test agent.\n', 'utf8');
  return dir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

interface RunResult {
  displays: unknown[];
  trace: TraceEvent[];
  error?: Error;
}

/** Run a Session with a mock streamFn + a temp trace file, then read it all back. */
async function runMockSession(args: {
  streamFn: SessionDeps['streamFn'];
  message: string;
  continueWith?: string[];
  budget?: BudgetLimits;
  roleModels?: { explore?: string; plan?: string; general?: string };
  systemSpaceDirs?: string[];
}): Promise<RunResult> {
  const spaceDir = await makeSpace();
  const traceFile = join(spaceDir, 'trace.jsonl');
  const displays: unknown[] = [];
  const host: RenderHost = {
    display: (d) => { displays.push(d); },
    ask: async () => undefined,
    log: () => {},
  };
  const session = new Session(
    {
      spaceDir,
      agentSlug: 'default',
      modelAlias: 'mock',
      renderHost: host,
      traceFile,
      systemSpaceDirs: args.systemSpaceDirs ?? [],
      budget: args.budget,
      roleModels: args.roleModels,
    },
    { streamFn: args.streamFn },
  );

  let error: Error | undefined;
  try {
    await session.start(args.message);
    for (const m of args.continueWith ?? []) await session.continue(m);
  } catch (e) {
    error = e as Error;
  }
  session.dispose();

  let trace: TraceEvent[] = [];
  try {
    const raw = await readFile(traceFile, 'utf8');
    trace = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as TraceEvent);
  } catch { /* no trace */ }
  return { displays, trace, error };
}

type LlmRequest = Extract<TraceEvent, { type: 'llm_request' }>;
const llmRequests = (t: TraceEvent[], ctx?: string): LlmRequest[] =>
  t.filter((e): e is LlmRequest => e.type === 'llm_request' && (ctx === undefined || e.context === ctx));
const forkRequests = (t: TraceEvent[]): LlmRequest[] =>
  t.filter((e): e is LlmRequest => e.type === 'llm_request' && e.context.startsWith('fork'));

// ---------------------------------------------------------------------------
// Phase 1 — budget guardrails
// ---------------------------------------------------------------------------

describe('mock-driven Session — budget guardrails (Phase 1)', () => {
  // Yields a sleep every turn so the loop never stops on its own — only a cap stops it.
  const tickForever = createMockStreamFn(() => 'await sleep("1ms");');

  it('episode cap fires with a clean BudgetExceededError and stops at the limit', async () => {
    const r = await runMockSession({ streamFn: tickForever, message: 'go', budget: { maxEpisodes: 3 } });
    expect(r.error).toBeInstanceOf(BudgetExceededError);
    expect((r.error as BudgetExceededError).kind).toBe('episodes');
    expect(r.error!.message).toContain('episodes limit of 3');
    expect(llmRequests(r.trace, 'session').length).toBe(3); // no 4th request
  });

  it('tool-call cap fires', async () => {
    const r = await runMockSession({ streamFn: tickForever, message: 'go', budget: { maxToolCalls: 2 } });
    expect(r.error).toBeInstanceOf(BudgetExceededError);
    expect((r.error as BudgetExceededError).kind).toBe('toolCalls');
    expect(r.error!.message).toContain('toolCalls limit of 2');
  });

  it('wall-clock cap fires', async () => {
    const slow = createMockStreamFn(() => 'await sleep("30ms");');
    const r = await runMockSession({ streamFn: slow, message: 'go', budget: { maxWallClockMs: 40 } });
    expect(r.error).toBeInstanceOf(BudgetExceededError);
    expect((r.error as BudgetExceededError).kind).toBe('wallClock');
  });

  it('fork-depth cap rejects cheaply — no fork VM is created (the fork resolves undefined)', async () => {
    // fork() yields, so the display must come on the NEXT turn (post-resolve).
    let turn = 0;
    const m = mockMatch(
      [{ when: /currentTask/, respond: () => 'currentTask.resolve({ summary: "x" });' }],
      () => {
        turn += 1;
        if (turn === 1) return `const f = await fork({ role: 'general', instruction: 'x', output: { summary: 'string' } });`;
        if (turn === 2) return `display("f=" + JSON.stringify(f));`;
        return '';
      },
    );
    const r = await runMockSession({ streamFn: m, message: 'go', budget: { maxForkDepth: 0 } });
    expect(r.error).toBeUndefined(); // depth rejection is swallowed; the session completes
    expect(forkRequests(r.trace).length).toBe(0); // cheap rejection: no fork turn ran
    expect(r.displays).toContain('f=undefined'); // the fork() yield resolved undefined
  });

  it('a within-budget run completes normally (cap is a no-op)', async () => {
    const m = createMockStreamFn((_o, { callIndex }) => (callIndex === 0 ? 'display("hello");' : ''));
    const r = await runMockSession({
      streamFn: m,
      message: 'go',
      budget: { maxEpisodes: 50, maxToolCalls: 50, maxForkDepth: 5 },
    });
    expect(r.error).toBeUndefined();
    expect(r.displays).toEqual(['hello']);
  });

  it('the budget resets per continue() turn (maxEpisodes:1 succeeds twice)', async () => {
    // One non-yielding display per turn = one episode. With a shared budget the 2nd
    // message would trip maxEpisodes:1; a per-turn reset lets both succeed.
    const m = createMockStreamFn(() => 'display("turn");');
    const r = await runMockSession({ streamFn: m, message: 'one', continueWith: ['two'], budget: { maxEpisodes: 1 } });
    expect(r.error).toBeUndefined();
    expect(r.displays).toEqual(['turn', 'turn']);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — progress()
// ---------------------------------------------------------------------------

describe('mock-driven Session — progress() (Phase 2)', () => {
  it('reads sane live counters', async () => {
    const m = createMockStreamFn((_o, { callIndex }) =>
      callIndex === 0
        ? `const p = progress();\ndisplay(JSON.stringify({ e: p.episodes, t: p.toolCalls, ms: p.elapsedMs }));`
        : '',
    );
    const r = await runMockSession({ streamFn: m, message: 'go' });
    const snap = JSON.parse(r.displays[0] as string) as { e: number; t: number; ms: number };
    expect(snap.e).toBeGreaterThanOrEqual(1);
    expect(snap.t).toBeGreaterThanOrEqual(0);
    expect(snap.ms).toBeGreaterThanOrEqual(0);
  });

  it('counts climb across a yield (the sleep is counted as a tool call)', async () => {
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) return 'await sleep("1ms");';
      if (callIndex === 1) return `const p = progress();\ndisplay(JSON.stringify({ e: p.episodes, t: p.toolCalls }));`;
      return '';
    });
    const r = await runMockSession({ streamFn: m, message: 'go' });
    const snap = JSON.parse(r.displays[0] as string) as { e: number; t: number };
    expect(snap.e).toBeGreaterThanOrEqual(2);
    expect(snap.t).toBeGreaterThanOrEqual(1);
  });

  it('is read-only — mutating a snapshot does not change the real counters', async () => {
    // All non-yielding, so they must be in one turn (the loop ends after a non-yielding turn).
    const single = createMockStreamFn((_o, { callIndex }) =>
      callIndex === 0
        ? `const a = progress();\na.episodes = 999;\nconst b = progress();\ndisplay(JSON.stringify({ a: a.episodes, b: b.episodes }));`
        : '',
    );
    const r = await runMockSession({ streamFn: single, message: 'go' });
    const snap = JSON.parse(r.displays[0] as string) as { a: number; b: number };
    expect(snap.a).toBe(999); // local mutation on the returned object
    expect(snap.b).toBeLessThan(999); // a fresh snapshot reflects the real (small) count
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — solve escalation (verifyCondition keeps it fast, no tsc spawn)
// ---------------------------------------------------------------------------

/** Build a mock that drives one solve() call: the orchestrator emits the call then
 *  displays the result; each attempt fork resolves a { score } chosen by scoreFor. */
function makeSolveMock(solveCall: string, scoreFor: (isRetry: boolean) => number): SessionDeps['streamFn'] {
  let orchestrator = 0;
  return createMockStreamFn((o) => {
    const hay = o.system + '\n' + o.messages.map((m) => m.content).join('\n');
    if (hay.includes('currentTask')) {
      const isRetry = hay.includes('Feedback from the previous attempt');
      return `currentTask.resolve({ score: ${scoreFor(isRetry)} });`;
    }
    orchestrator += 1;
    if (orchestrator === 1) return solveCall;
    if (orchestrator === 2) return `display(JSON.stringify({ rung: r.rung, attempts: r.attempts, verified: r.verified }));`;
    return '';
  });
}

const SOLVE_VERIFIED =
  `const r = await solve({ instruction: "produce a score", output: { score: "number" }, ` +
  `verifyCondition: "score >= 10", maxAttempts: 6 }) as ` +
  `{ value: { score: number }; rung: number; attempts: number; verified: boolean };`;

describe('mock-driven Session — solve escalation (Phase 3)', () => {
  it('3A: verifies on the first attempt → rung 0, attempts 1, one fork', async () => {
    const r = await runMockSession({ streamFn: makeSolveMock(SOLVE_VERIFIED, () => 20), message: 'go' });
    const out = JSON.parse(r.displays[0] as string) as { rung: number; attempts: number; verified: boolean };
    expect(out).toEqual({ rung: 0, attempts: 1, verified: true });
    expect(forkRequests(r.trace).length).toBe(1); // no escalation when easy
  });

  it('3B: one retry → rung 1, attempts 2, and the retry fork carries the verifier feedback', async () => {
    const r = await runMockSession({
      streamFn: makeSolveMock(SOLVE_VERIFIED, (isRetry) => (isRetry ? 20 : 5)),
      message: 'go',
    });
    const out = JSON.parse(r.displays[0] as string) as { rung: number; attempts: number; verified: boolean };
    expect(out).toEqual({ rung: 1, attempts: 2, verified: true });
    const withFeedback = forkRequests(r.trace).filter((e) =>
      e.messages.some((m) => m.content.includes('Feedback from the previous attempt')),
    );
    expect(withFeedback.length).toBeGreaterThanOrEqual(1);
  });

  it('3D: no verify spec → single shot, verified:false, rung 0', async () => {
    const noVerify =
      `const r = await solve({ instruction: "produce a score", output: { score: "number" } }) as ` +
      `{ value: { score: number }; rung: number; attempts: number; verified: boolean };`;
    const r = await runMockSession({ streamFn: makeSolveMock(noVerify, () => 5), message: 'go' });
    const out = JSON.parse(r.displays[0] as string) as { rung: number; attempts: number; verified: boolean };
    expect(out).toEqual({ rung: 0, attempts: 1, verified: false });
    expect(forkRequests(r.trace).length).toBe(1);
  });

  it('3E: impossible spec → escalates then exhausts honestly (verified:false, bounded attempts)', async () => {
    const bounded =
      `const r = await solve({ instruction: "produce a score", output: { score: "number" }, ` +
      `verifyCondition: "score >= 10", maxAttempts: 3 }) as ` +
      `{ value: { score: number }; rung: number; attempts: number; verified: boolean };`;
    const r = await runMockSession({ streamFn: makeSolveMock(bounded, () => 1), message: 'go' });
    const out = JSON.parse(r.displays[0] as string) as { rung: number; attempts: number; verified: boolean };
    expect(out.verified).toBe(false);
    expect(out.attempts).toBeGreaterThan(1); // it escalated
    expect(out.attempts).toBeLessThanOrEqual(3); // bounded by maxAttempts
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — per-role fork models on the trace
// ---------------------------------------------------------------------------

/** Mock that spawns one explore fork then summarizes — for asserting the fork's model. */
function makeExploreForkMock(): SessionDeps['streamFn'] {
  let turn = 0;
  return mockMatch(
    [{ when: /currentTask/, respond: () => 'currentTask.resolve({ summary: "found it" });' }],
    () =>
      turn++ === 0
        ? `const x = await fork({ role: 'explore', instruction: 'investigate', output: { summary: 'string' } });\n` +
          `display("x=" + (x && x.summary));`
        : '',
  );
}

describe('mock-driven Session — per-role models (Phase 4)', () => {
  it('an explore fork carries its configured role model on the llm_request', async () => {
    const r = await runMockSession({
      streamFn: makeExploreForkMock(),
      message: 'go',
      roleModels: { explore: 'cheap-model' },
    });
    const exploreReqs = r.trace.filter((e): e is LlmRequest => e.type === 'llm_request' && e.context === 'fork:explore');
    expect(exploreReqs.length).toBeGreaterThanOrEqual(1);
    expect(exploreReqs.every((e) => e.model === 'cheap-model')).toBe(true);
    // The session's own requests are unaffected (default model = undefined here).
    expect(llmRequests(r.trace, 'session').every((e) => e.model === undefined)).toBe(true);
  });

  it('no role config → the fork request carries no model override (session default)', async () => {
    const r = await runMockSession({ streamFn: makeExploreForkMock(), message: 'go' });
    const exploreReqs = r.trace.filter((e): e is LlmRequest => e.type === 'llm_request' && e.context === 'fork:explore');
    expect(exploreReqs.length).toBeGreaterThanOrEqual(1);
    expect(exploreReqs.every((e) => e.model === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug fixes — observed through a mock-driven Session
// ---------------------------------------------------------------------------

describe('mock-driven Session — bug fixes', () => {
  it('process.exit() ends the run cleanly instead of retrying the same code', async () => {
    const m = createMockStreamFn(() => 'process.exit(1);'); // every turn, if it retried
    const r = await runMockSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    expect(llmRequests(r.trace, 'session').length).toBe(1); // NOT retried 3×
  });

  it('a `let` declared without an initializer is visible to a later statement', async () => {
    // Repro of variable-scoping-let-across-statements: declare in one statement,
    // reference in the next. Without propagation this throws ReferenceError.
    const m = createMockStreamFn((_o, { callIndex }) =>
      callIndex === 0 ? `let parsed;\ndisplay("parsed is " + parsed);` : '',
    );
    const r = await runMockSession({ streamFn: m, message: 'go' });
    expect(r.trace.some((e) => e.type === 'eval_error')).toBe(false);
    expect(r.displays).toContain('parsed is undefined');
  });

  it('execShell exposes a non-zero exitCode (and it type-checks)', async () => {
    const m = createMockStreamFn((_o, { callIndex }) =>
      callIndex === 0 ? `const r = execShell("exit 5");\ndisplay("exit=" + r.exitCode);` : '',
    );
    const r = await runMockSession({ streamFn: m, message: 'go' });
    expect(r.trace.some((e) => e.type === 'typecheck_error')).toBe(false);
    expect(r.displays).toContain('exit=5');
  });

  it('grep distinguishes a missing path from "no matches"', async () => {
    const m = createMockStreamFn((_o, { callIndex }) =>
      callIndex === 0
        ? `const g = grep("x", { path: "/tmp/no-such-dir-xyz-12345" });\ndisplay("ok=" + g.ok + " err=" + (g.error || ""));`
        : '',
    );
    // grep is a system function — enable the fs system space for this run.
    const r = await runMockSession({ streamFn: m, message: 'go', systemSpaceDirs: [join(SYSTEM_SPACES_ROOT, 'fs')] });
    expect(r.trace.some((e) => e.type === 'typecheck_error')).toBe(false);
    expect(String(r.displays[0])).toContain('ok=false');
    expect(String(r.displays[0])).toContain('path not found');
  });
});

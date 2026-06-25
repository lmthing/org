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

// ---------------------------------------------------------------------------
// Phase 0 — buildSystemPrompt() (keyless; backs the CLI --dump-system-prompt flag)
// ---------------------------------------------------------------------------

describe('Session.buildSystemPrompt (keyless prompt dump)', () => {
  const neverCalled = createMockStreamFn(() => { throw new Error('streamFn must not be called by buildSystemPrompt'); });
  const host: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

  it('builds the system block + ambient DTS without creating a VM or calling the model', async () => {
    const spaceDir = await makeSpace();
    const session = new Session(
      { spaceDir, agentSlug: 'default', modelAlias: 'mock', renderHost: host, systemSpaceDirs: [join(SYSTEM_SPACES_ROOT, 'system-global')] },
      { streamFn: neverCalled },
    );
    const { agentSlug, systemBlock, ambientDts } = await session.buildSystemPrompt();
    session.dispose();
    expect(agentSlug).toBe('main'); // 'default' resolves to the sole agent
    expect(systemBlock).toContain('# Available Globals');
    // System functions present as signatures-only "Built-in Tools" when system spaces are loaded.
    expect(systemBlock).toContain('# Built-in Tools');
    expect(systemBlock).toContain('readFile');
    expect(ambientDts).toContain('declare function ask');
  });

  it('omits the Built-in Tools section when system spaces are disabled', async () => {
    const spaceDir = await makeSpace();
    const session = new Session(
      { spaceDir, agentSlug: 'default', modelAlias: 'mock', renderHost: host, systemSpaceDirs: [] },
      { streamFn: neverCalled },
    );
    const { systemBlock } = await session.buildSystemPrompt();
    session.dispose();
    expect(systemBlock).not.toContain('# Built-in Tools');
  });
});

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

  it('fork-depth cap aborts cleanly and cheaply (no fork VM is created)', async () => {
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
    expect(r.error).toBeInstanceOf(BudgetExceededError); // hard stop, like the other caps
    expect((r.error as BudgetExceededError).kind).toBe('forkDepth');
    expect(forkRequests(r.trace).length).toBe(0); // cheap rejection: no fork turn ran
    expect(r.displays).not.toContain('f=undefined'); // the run aborted before binding undefined
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

  it('1F: continue() after a capped start() gets a fresh budget and completes normally', async () => {
    // start() exhausts maxEpisodes=2: two sleeps consume 2 episodes, and the tick
    // for the 3rd turn fires BudgetExceededError before the streamFn is called.
    // continue() immediately resets the budget, so callIndex=2 runs fine.
    const spaceDir = await makeSpace();
    const traceFile = join(spaceDir, 'trace.jsonl');
    const displayed: unknown[] = [];
    const host: RenderHost = {
      display: (d) => { displayed.push(d); },
      ask: async () => undefined,
      log: () => {},
    };
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) return 'await sleep("1ms");';
      if (callIndex === 1) return 'await sleep("1ms");';
      // callIndex 2: tickEpisode throws for start() on episode 3, so this is reached
      // only from continue() (which created a fresh budget).
      return 'display("recovered");';
    });
    const session = new Session(
      { spaceDir, agentSlug: 'default', modelAlias: 'mock', renderHost: host, traceFile, systemSpaceDirs: [], budget: { maxEpisodes: 2 } },
      { streamFn: m },
    );
    let startErr: Error | undefined;
    try { await session.start('exhaust me'); } catch (e) { startErr = e as Error; }
    expect(startErr).toBeInstanceOf(BudgetExceededError);

    let continueErr: Error | undefined;
    try { await session.continue('try again'); } catch (e) { continueErr = e as Error; }
    session.dispose();

    expect(continueErr).toBeUndefined();
    expect(displayed).toContain('recovered');
  });

  it('1G: session.dispose() after a BudgetExceededError is safe and idempotent', async () => {
    const spaceDir = await makeSpace();
    const traceFile = join(spaceDir, 'trace.jsonl');
    const host: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };
    const m = createMockStreamFn(() => 'await sleep("1ms");');
    const session = new Session(
      { spaceDir, agentSlug: 'default', modelAlias: 'mock', renderHost: host, traceFile, systemSpaceDirs: [], budget: { maxEpisodes: 1 } },
      { streamFn: m },
    );
    let budgetErr: Error | undefined;
    try { await session.start('go'); } catch (e) { budgetErr = e as Error; }
    expect(budgetErr).toBeInstanceOf(BudgetExceededError);
    // First dispose — releases the VM that was created before runTurnLoop threw.
    expect(() => session.dispose()).not.toThrow();
    // Second dispose — must be a safe no-op (vm is null after the first call).
    expect(() => session.dispose()).not.toThrow();
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

  it('2D: progress() inside a fork returns the fork\'s own live counters', async () => {
    let sessionStep = 0;
    const m = mockMatch(
      [
        {
          when: /currentTask/,
          respond: () =>
            `const p = progress();\n` +
            `currentTask.resolve({ episodes: p.episodes, toolCalls: p.toolCalls, elapsedMs: p.elapsedMs });`,
        },
      ],
      () => {
        sessionStep++;
        if (sessionStep === 1)
          return `const f = await fork({ role: 'general', instruction: 'measure progress', output: { episodes: 'number', toolCalls: 'number', elapsedMs: 'number' } });`;
        if (sessionStep === 2) return `display(JSON.stringify(f));`;
        return '';
      },
    );
    const r = await runMockSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    const counters = JSON.parse(r.displays[0] as string) as { episodes: number; toolCalls: number; elapsedMs: number };
    // The fork had at least one LLM turn (to produce the resolve code).
    expect(counters.episodes).toBeGreaterThanOrEqual(1);
    expect(counters.toolCalls).toBeGreaterThanOrEqual(0);
    expect(counters.elapsedMs).toBeGreaterThanOrEqual(0);
    // The fork's counters are isolated: not the session's large accumulated count.
    expect(counters.episodes).toBeLessThan(100);
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
    const r = await runMockSession({ streamFn: m, message: 'go', systemSpaceDirs: [join(SYSTEM_SPACES_ROOT, 'system-global')] });
    expect(r.trace.some((e) => e.type === 'typecheck_error')).toBe(false);
    expect(String(r.displays[0])).toContain('ok=false');
    expect(String(r.displays[0])).toContain('path not found');
  });

  it('a variable bound before a mid-turn error survives into the retry', async () => {
    // Repro of the architect death-spiral: turn 1 binds `phase1` (success → globalThis),
    // then a later statement in the SAME turn errors. The retry references `phase1`.
    // Before the fix, the error rollback wiped `phase1` from the typecheck context
    // (while it still lived in the VM), so the retry failed with "Cannot find name
    // 'phase1'" and burned all 3 attempts. The retry must now typecheck and run.
    let attempt = 0;
    const m = createMockStreamFn(() => {
      attempt += 1;
      // Turn 1: a successful binding followed by a statement that type-checks but
      // throws at eval time (the real architect failure was an "interrupted" eval
      // error). JSON.parse on malformed input is a clean stand-in.
      if (attempt === 1) return `const phase1 = 42;\nconst bad = JSON.parse("{ broken");`;
      // Retry: reference the variable bound in turn 1 — must still be in scope.
      if (attempt === 2) return `display("phase1=" + phase1);`;
      return '';
    });
    const r = await runMockSession({ streamFn: m, message: 'go' });
    expect(r.trace.some((e) => e.type === 'eval_error')).toBe(true); // the original failure happened
    expect(r.trace.some((e) => e.type === 'typecheck_error')).toBe(false); // but the retry did NOT lose scope
    expect(r.displays).toContain('phase1=42');
    // The error block must advertise what's still in scope so the model won't redeclare.
    const errReq = llmRequests(r.trace, 'session')[1];
    const lastMsg = errReq!.messages[errReq!.messages.length - 1];
    expect(String(lastMsg?.content)).toContain('phase1');
  });
});

// ---------------------------------------------------------------------------
// §6.3 — integrity / reward-hacking regression
// ---------------------------------------------------------------------------

describe('defaultAction — structural routing for weak models', () => {
  // Build a space whose agent declares `defaultAction: build` → a freeform session
  // must run the `build` tasklist deterministically (via the delegate path) instead
  // of the model-driven turn loop. This is the structural guarantee that a model
  // which ignores routing prose still completes the multi-step pipeline.
  async function makeDefaultActionSpace(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lmthing-defaction-'));
    tmpDirs.push(dir);
    const agentFile = join(dir, 'agents', 'builder', 'instruct.md');
    await mkdir(dirname(agentFile), { recursive: true });
    await writeFile(
      agentFile,
      `---\ntitle: Builder\ndefaultAction: build\nactions:\n  - id: build\n    label: Build\n    description: Build the thing\n    tasklist: build\n---\n\nYou are a builder.\n`,
      'utf8',
    );
    const taskFile = join(dir, 'tasklists', 'build', '01-make.md');
    await mkdir(dirname(taskFile), { recursive: true });
    await writeFile(
      taskFile,
      `---\nid: make\ngoal: true\noutput:\n  answer: string\n---\n\nMAKE_TASK: produce the answer and resolve.`,
      'utf8',
    );
    return dir;
  }

  it('runs the action tasklist deterministically and never invokes the freeform session model', async () => {
    const spaceDir = await makeDefaultActionSpace();
    const traceFile = join(spaceDir, 'trace.jsonl');
    const displays: unknown[] = [];
    const host: RenderHost = { display: (d) => { displays.push(d); }, ask: async () => undefined, log: () => {} };

    const m = mockMatch(
      [
        // The build-tasklist task fork resolves the goal output.
        { when: (o) => o.messages.some((msg) => msg.content.includes('MAKE_TASK') && msg.content.includes('Output schema')), respond: () => `currentTask.resolve({ answer: "BUILT_OK" });` },
        // The delegate agent turn: run the action's tasklist (auto-captured).
        { when: (o) => o.messages.some((msg) => msg.content.includes('Run action: build')), respond: () => `const r = await tasklist("build", {});` },
      ],
      // Fallback = the freeform SESSION model. If defaultAction routing works, this is NEVER called.
      () => `display("SESSION_MODEL_RAN");`,
    );

    const session = new Session(
      { spaceDir, agentSlug: 'builder', modelAlias: 'mock', renderHost: host, traceFile, systemSpaceDirs: [] },
      { streamFn: m },
    );
    await session.start('build me something');
    session.dispose();

    const flat = JSON.stringify(displays);
    expect(flat).toContain('BUILT_OK');          // the deterministic tasklist result was shown
    expect(flat).not.toContain('SESSION_MODEL_RAN'); // the unreliable freeform model never ran
  });
});

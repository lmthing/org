import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Session } from '../session/session.js';
import { createMockStreamFn, mockMatch } from './mock-provider.js';
import type { RenderHost, SessionDeps, SessionOpts } from '../session/types.js';
import type { TraceEvent } from '../sandbox/trace.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * Keyless, end-to-end coverage of the runtime harness — every value-yielding
 * global and orchestration feature driven through a REAL Session with the
 * scripted mock provider (no API keys). This is the deterministic counterpart
 * to scripts/live-test.sh and the companion to mock-session.test.ts (which
 * owns budget/progress/solve); here we exercise the features those tests don't:
 *
 *   - ask()              host round-trip + result binding
 *   - inspect()          yields, returns the value, and lands in the next VARIABLES block
 *   - loadKnowledge()    reads a knowledge file and binds its parsed content
 *   - sleep()            yields and resumes, ordering preserved across the gap
 *   - fork() roles       parallel Promise.all binding order + read-only capability gating
 *   - tasklist()         DAG orchestration: dependsOn ordering, seed, upstream wiring, goal output
 *   - delegate()         runs a child agent's action and captures its result
 *   - registerSpace()    runtime space registration, then delegate to the registered key
 *   - system spaces      fs (write/read/glob/listDir/editFile), memory, todo — merged into every space
 *   - history summary    session.continue() collapses old turns past maxHistoryTurns
 */

// system-spaces live at packages/core/system-spaces (not under src/), so resolve
// them the way the other system tests do — defaultSystemSpaceDirs() assumes the
// dist/ layout and would point at a nonexistent dir when run from src.
const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_SPACES_ROOT = join(__dirname, '..', '..', 'system-spaces');
const fsSpace = join(SYSTEM_SPACES_ROOT, 'fs');
const memorySpace = join(SYSTEM_SPACES_ROOT, 'memory');
const todoSpace = join(SYSTEM_SPACES_ROOT, 'todo');

const tmpDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Minimal one-agent space on disk (no functions, no tasklists). */
async function makeSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-harness-'));
  tmpDirs.push(dir);
  const file = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'You are a test agent.\n', 'utf8');
  return dir;
}

interface RunResult {
  displays: unknown[];
  logs: string[];
  trace: TraceEvent[];
  error?: Error;
}

/** Run a Session with a mock streamFn + a temp trace file, then read everything back. */
async function runSession(args: {
  streamFn: SessionDeps['streamFn'];
  message: string;
  continueWith?: string[];
  spaceDir?: string;
  ask?: RenderHost['ask'];
  systemSpaceDirs?: string[];
  maxHistoryTurns?: number;
  extraOpts?: Partial<SessionOpts>;
}): Promise<RunResult> {
  const spaceDir = args.spaceDir ?? (await makeSpace());
  const traceFile = join(spaceDir, 'trace.jsonl');
  const displays: unknown[] = [];
  const logs: string[] = [];
  const host: RenderHost = {
    display: (d) => { displays.push(d); },
    ask: args.ask ?? (async () => undefined),
    log: (m) => { logs.push(m); },
  };
  const session = new Session(
    {
      spaceDir,
      agentSlug: 'default',
      modelAlias: 'mock',
      renderHost: host,
      traceFile,
      systemSpaceDirs: args.systemSpaceDirs ?? [],
      maxHistoryTurns: args.maxHistoryTurns,
      ...args.extraOpts,
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
  return { displays, logs, trace, error };
}

/** Combined system+messages haystack — the same text mockMatch routes on. */
function haystack(o: StreamOpts): string {
  return o.system + '\n' + o.messages.map((m) => m.content).join('\n');
}

type ForkReq = Extract<TraceEvent, { type: 'llm_request' }>;
const forkRequests = (t: TraceEvent[]): ForkReq[] =>
  t.filter((e): e is ForkReq => e.type === 'llm_request' && e.context.startsWith('fork'));

/** Flatten a traced llm_request (system + messages) into one searchable string. */
const reqText = (e: ForkReq): string => e.system + '\n' + e.messages.map((m) => m.content).join('\n');

/**
 * A mockMatch rule that fires only inside a FORK/tasklist-task turn whose
 * instruction contains `token`. The fork's user prompt is the only place the
 * literal "Output schema:" appears, so matching on it (plus the token) avoids
 * false matches on the parent session's continuation turns — where the same
 * token shows up in the assistant code that called fork(). (The system block is
 * NOT a discriminator: the session prompt carries the same preamble.)
 */
function forkRule(token: string, code: string) {
  return {
    when: (o: StreamOpts) =>
      o.messages.some((m) => m.content.includes('Output schema:') && m.content.includes(token)),
    respond: () => code,
  };
}

// ---------------------------------------------------------------------------
// ask() — host round-trip
// ---------------------------------------------------------------------------

describe('harness — ask()', () => {
  it('yields to the host and binds the returned answer into scope', async () => {
    // A yielding statement aborts the turn, so the ask() and the display() that
    // consumes its result must live in separate turns (callIndex 0 then 1).
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0)
        return `const name = await ask({ type: "input", props: { label: "name?" }, children: [] });`;
      if (callIndex === 1) return `display("hi " + name);`;
      return '';
    });
    const r = await runSession({
      streamFn: m,
      message: 'go',
      ask: async (_id, descriptor) => {
        // The descriptor the model built is handed through to the host untouched.
        expect((descriptor as { props: { label: string } }).props.label).toBe('name?');
        return 'Ada';
      },
    });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('hi Ada');
    // The yield was traced as an ask and resolved with the host's answer.
    expect(r.trace.some((e) => e.type === 'yield' && e.kind === 'ask')).toBe(true);
    expect(
      r.trace.some((e) => e.type === 'yield_resolved' && e.kind === 'ask' && e.value === 'Ada'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// inspect() — peek at a value, surfaced in the next turn's VARIABLES
// ---------------------------------------------------------------------------

describe('harness — inspect()', () => {
  it('yields and the inspected value reaches the model on the continuation turn', async () => {
    const promptsAfterInspect: string[] = [];
    let step = 0;
    const m = createMockStreamFn((o, { callIndex }) => {
      if (callIndex > 0) promptsAfterInspect.push(haystack(o));
      step++;
      if (step === 1)
        return `const data = { items: [1, 2, 3], label: "widget" };\nawait inspect(data);`;
      if (step === 2) return `display("inspected");`;
      return '';
    });
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('inspected');
    // inspect was traced as a yield.
    expect(r.trace.some((e) => e.type === 'yield' && e.kind === 'inspect')).toBe(true);
    // The continuation prompt carried the inspected content forward.
    expect(promptsAfterInspect.join('\n')).toContain('widget');
  });

  it('applies an inspect query (count) before surfacing the value', async () => {
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0)
        return `const big = [10, 20, 30, 40];\nconst n = await inspect([big, { count: true }]);`;
      if (callIndex === 1) return `display("count=" + JSON.stringify(n));`;
      return '';
    });
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    // The yield resolves to the processed { value, query } record; the value is the count (4).
    const out = String(r.displays.find((d) => String(d).startsWith('count=')));
    expect(out).toContain('4');
  });
});

// ---------------------------------------------------------------------------
// loadKnowledge() — read a knowledge file and bind its parsed content
// ---------------------------------------------------------------------------

describe('harness — loadKnowledge()', () => {
  it('reads a frontmatter knowledge file and binds { frontmatter, body }', async () => {
    const spaceDir = await makeSpace();
    const kfile = join(spaceDir, 'knowledge', 'facts', 'pasta.md');
    await mkdir(dirname(kfile), { recursive: true });
    await writeFile(kfile, '---\nregion: Italy\n---\n\nCook pasta in salted boiling water.', 'utf8');

    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) return `const k = await loadKnowledge("facts", "pasta.md");`;
      if (callIndex === 1)
        return `display("region=" + (k as any).frontmatter.region);\ndisplay("body=" + (k as any).body);`;
      return '';
    });
    const r = await runSession({ streamFn: m, message: 'go', spaceDir });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('region=Italy');
    expect(r.displays).toContain('body=Cook pasta in salted boiling water.');
    expect(r.trace.some((e) => e.type === 'yield' && e.kind === 'loadKnowledge')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sleep() — yields and resumes, ordering preserved
// ---------------------------------------------------------------------------

describe('harness — sleep()', () => {
  it('pauses and resumes; displays straddling the yield keep their order', async () => {
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) return `display("before");\nawait sleep("1ms");`;
      if (callIndex === 1) return `display("after");`;
      return '';
    });
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    expect(r.displays).toEqual(['before', 'after']);
    expect(r.trace.some((e) => e.type === 'yield' && e.kind === 'sleep')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fork() — parallel binding order and role capability gating
// ---------------------------------------------------------------------------

describe('harness — fork()', () => {
  it('binds parallel Promise.all fork results positionally (source order)', async () => {
    let sessionStep = 0;
    const m = mockMatch(
      [
        forkRule('ALPHA_TASK', `currentTask.resolve({ tag: "a" });`),
        forkRule('BETA_TASK', `currentTask.resolve({ tag: "b" });`),
      ],
      () => {
        sessionStep++;
        if (sessionStep === 1)
          return (
            `const [x, y] = await Promise.all([\n` +
            `  fork({ role: 'general', instruction: 'ALPHA_TASK', output: { tag: 'string' } }),\n` +
            `  fork({ role: 'general', instruction: 'BETA_TASK', output: { tag: 'string' } }),\n` +
            `]);`
          );
        if (sessionStep === 2)
          return `display(JSON.stringify({ x: (x as any).tag, y: (y as any).tag }));`;
        return '';
      },
    );
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    const out = JSON.parse(r.displays[0] as string) as { x: string; y: string };
    expect(out).toEqual({ x: 'a', y: 'b' }); // positional, not swapped
    expect(forkRequests(r.trace).length).toBe(2);
  });

  it('an explore (read-only) fork cannot write — writeFileRaw is withheld', async () => {
    const probe = join(await makeSpace(), 'explore-probe.txt');
    let sessionStep = 0;
    const m = mockMatch(
      [
        // The fork tries to write; the host returns ok:false for read-only roles.
        forkRule(
          'EXPLORE_WRITE',
          `const w = writeFileRaw(${JSON.stringify(probe)}, "nope");\n` +
            `currentTask.resolve({ wrote: w.ok });`,
        ),
      ],
      () => {
        sessionStep++;
        if (sessionStep === 1)
          return `const f = await fork({ role: 'explore', instruction: 'EXPLORE_WRITE', output: { wrote: 'boolean' } });`;
        if (sessionStep === 2) return `display("wrote=" + (f as any).wrote);`;
        return '';
      },
    );
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('wrote=false'); // write was blocked at injection, not merely discouraged
    // And the file was never created.
    await expect(readFile(probe, 'utf8')).rejects.toThrow();
  });

  it('a general fork CAN write — the same op succeeds with the full toolkit', async () => {
    const probe = join(await makeSpace(), 'general-probe.txt');
    let sessionStep = 0;
    const m = mockMatch(
      [
        forkRule(
          'GENERAL_WRITE',
          `const w = writeFileRaw(${JSON.stringify(probe)}, "ok");\n` +
            `currentTask.resolve({ wrote: w.ok });`,
        ),
      ],
      () => {
        sessionStep++;
        if (sessionStep === 1)
          return `const f = await fork({ role: 'general', instruction: 'GENERAL_WRITE', output: { wrote: 'boolean' } });`;
        if (sessionStep === 2) return `display("wrote=" + (f as any).wrote);`;
        return '';
      },
    );
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('wrote=true');
    expect(await readFile(probe, 'utf8')).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// tasklist() — DAG orchestration
// ---------------------------------------------------------------------------

/** Build a two-task pipeline: second dependsOn first (goal). */
async function makePipelineSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-tasklist-'));
  tmpDirs.push(dir);
  const agent = join(dir, 'agents', 'main', 'instruct.md');
  await mkdir(dirname(agent), { recursive: true });
  await writeFile(agent, 'You are a pipeline runner.\n', 'utf8');

  const tl = join(dir, 'tasklists', 'pipeline');
  await mkdir(tl, { recursive: true });
  await writeFile(
    join(tl, '01-first.md'),
    `---\nid: first\noutput:\n  a: number\n---\n\nFIRST_TASK: produce the seed-derived value.`,
    'utf8',
  );
  await writeFile(
    join(tl, '02-second.md'),
    `---\nid: second\ndependsOn:\n  - first\ngoal: true\noutput:\n  b: number\n---\n\nSECOND_TASK: add one to the upstream value.`,
    'utf8',
  );
  return dir;
}

describe('harness — tasklist()', () => {
  it('runs a dependsOn DAG with seed + upstream wiring and returns the goal output', async () => {
    const dir = await makePipelineSpace();
    let sessionStep = 0;
    const m = mockMatch(
      [
        // first: reads the seed variable injected into the fork VM.
        forkRule('FIRST_TASK', `currentTask.resolve({ a: seedVal });`),
        // second: reads the upstream task's output, injected under its task id.
        forkRule('SECOND_TASK', `currentTask.resolve({ b: (first as any).a + 1 });`),
      ],
      () => {
        sessionStep++;
        if (sessionStep === 1) return `const out = await tasklist("pipeline", { seedVal: 7 });`;
        if (sessionStep === 2) return `display(JSON.stringify(out));`;
        return '';
      },
    );
    const r = await runSession({ streamFn: m, message: 'go', spaceDir: dir });
    expect(r.error).toBeUndefined();
    // Goal task is `second`; its output is what tasklist() resolves to.
    expect(JSON.parse(r.displays[0] as string)).toEqual({ b: 8 });
    // Two tasks ⟹ two fork turns, and they ran in dependency order (first before second).
    const forks = forkRequests(r.trace);
    expect(forks.length).toBe(2);
    const firstIdx = forks.findIndex((e) => reqText(e).includes('FIRST_TASK'));
    const secondIdx = forks.findIndex((e) => reqText(e).includes('SECOND_TASK'));
    expect(firstIdx).toBeLessThan(secondIdx);
    // The downstream fork actually received the upstream output.
    expect(reqText(forks[secondIdx]!)).toContain('first');
  });
});

// ---------------------------------------------------------------------------
// delegate() + registerSpace() — child agents
// ---------------------------------------------------------------------------

/** A standalone target space with one agent + a no-tasklist action. */
async function makeWorkerSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-worker-'));
  tmpDirs.push(dir);
  const agent = join(dir, 'agents', 'worker', 'instruct.md');
  await mkdir(dirname(agent), { recursive: true });
  await writeFile(
    agent,
    `---\ntitle: Worker\nactions:\n  - id: compute\n    label: Compute\n    description: Compute a value\n---\n\nYou are a worker. Implement the compute action.`,
    'utf8',
  );
  return dir;
}

describe('harness — delegate()', () => {
  it('runs a child agent action and captures the result back in the parent', async () => {
    const workerDir = await makeWorkerSpace();
    let sessionStep = 0;
    const m = mockMatch(
      [
        // The delegate child sees "Run action: compute" — resolve directly.
        { when: /Run action: compute/, respond: () => `currentTask.resolve({ result: 42 });` },
      ],
      () => {
        sessionStep++;
        if (sessionStep === 1)
          return `const d = await delegate(${JSON.stringify(workerDir)}, "worker", "compute", { query: "go" }) as { result: number };`;
        if (sessionStep === 2) return `display("result=" + (d as any).result);`;
        return '';
      },
    );
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('result=42');
    // The child ran under a delegate trace context.
    expect(r.trace.some((e) => e.type === 'llm_request' && e.context.startsWith('delegate:'))).toBe(true);
  });
});

describe('harness — registerSpace()', () => {
  it('registers a space at runtime and a later delegate reaches it by spaceKey', async () => {
    const workerDir = await makeWorkerSpace();
    let sessionStep = 0;
    const m = mockMatch(
      [
        { when: /Run action: compute/, respond: () => `currentTask.resolve({ result: 99 });` },
      ],
      () => {
        sessionStep++;
        if (sessionStep === 1)
          return `const reg = await registerSpace(${JSON.stringify(workerDir)});`;
        if (sessionStep === 2)
          return (
            `display("ok=" + reg.ok + " slug=" + reg.agentSlug);\n` +
            `const d = await delegate(reg.spaceKey, reg.agentSlug, "compute", { query: "go" }) as { result: number };`
          );
        if (sessionStep === 3) return `display("delegated=" + (d as any).result);`;
        return '';
      },
    );
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    // registerSpace returned the contract { ok, spaceKey, agentSlug }.
    expect(r.displays).toContain('ok=true slug=worker');
    // And the delegate routed through the freshly registered key.
    expect(r.displays).toContain('delegated=99');
    expect(r.trace.some((e) => e.type === 'yield' && e.kind === 'registerSpace')).toBe(true);
  });

  it('reports an error (ok:false) for a directory that is not a space', async () => {
    const bogus = join(tmpdir(), 'lmthing-not-a-space-xyz-12345');
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) return `const reg = await registerSpace(${JSON.stringify(bogus)});`;
      if (callIndex === 1) return `display("ok=" + reg.ok);`;
      return '';
    });
    const r = await runSession({ streamFn: m, message: 'go' });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('ok=false');
  });
});

// ---------------------------------------------------------------------------
// System spaces — always merged in (fs / memory / todo)
// ---------------------------------------------------------------------------

describe('harness — system spaces (fs)', () => {
  it('writeFile → readFile round-trips through the fs system space', async () => {
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) {
        return (
          `const dir = process.env.LMTHING_SPACE_DIR ?? ".";\n` +
          `const w = writeFile(dir + "/note.txt", "hello fs");\n` +
          `const r = readFile(dir + "/note.txt");\n` +
          `display("wrote=" + w.ok + " read=" + r.raw);`
        );
      }
      return '';
    });
    const r = await runSession({ streamFn: m, message: 'go', systemSpaceDirs: [fsSpace] });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('wrote=true read=hello fs');
  });

  it('glob and listDir see files written into the space dir', async () => {
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) {
        return (
          `const dir = process.env.LMTHING_SPACE_DIR ?? ".";\n` +
          `writeFile(dir + "/a.txt", "1");\n` +
          `writeFile(dir + "/b.txt", "2");\n` +
          `const g = glob("*.txt", { cwd: dir });\n` +
          `const l = listDir(dir);\n` +
          `display("globs=" + g.paths.length + " hasA=" + l.entries.includes("a.txt"));`
        );
      }
      return '';
    });
    const r = await runSession({ streamFn: m, message: 'go', systemSpaceDirs: [fsSpace] });
    expect(r.error).toBeUndefined();
    const out = String(r.displays[0]);
    expect(out).toContain('globs=2');
    expect(out).toContain('hasA=true');
  });

  it('editFile replaces an exact string in place', async () => {
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) {
        return (
          `const dir = process.env.LMTHING_SPACE_DIR ?? ".";\n` +
          `const p = dir + "/edit.txt";\n` +
          `writeFile(p, "the quick brown fox");\n` +
          `const e = editFile(p, "quick", "slow");\n` +
          `const r = readFile(p);\n` +
          `display("rep=" + e.replacements + " body=" + r.raw);`
        );
      }
      return '';
    });
    const r = await runSession({ streamFn: m, message: 'go', systemSpaceDirs: [fsSpace] });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('rep=1 body=the slow brown fox');
  });
});

describe('harness — system spaces (memory)', () => {
  it('remember → recall persists a fact across turns', async () => {
    // start() saves; continue() recalls — the store is a JSON file under the space dir,
    // so the value survives the turn boundary.
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0) return `const w = remember("color", "blue");\ndisplay("saved=" + w.ok);`;
      if (callIndex === 1) return `const c = recall("color");\ndisplay("recall=" + c.found + ":" + c.value);`;
      return '';
    });
    const r = await runSession({
      streamFn: m,
      message: 'save',
      continueWith: ['load'],
      systemSpaceDirs: [memorySpace, fsSpace],
    });
    expect(r.error).toBeUndefined();
    expect(r.displays).toContain('saved=true');
    expect(r.displays).toContain('recall=true:blue');
  });
});

describe('harness — system spaces (todo)', () => {
  it('todoWrite renders a checklist via display and todoRead reads it back', async () => {
    const m = createMockStreamFn((_o, { callIndex }) => {
      if (callIndex === 0)
        return (
          `todoWrite([\n` +
          `  { content: "step one", status: "completed" },\n` +
          `  { content: "step two", status: "in_progress" },\n` +
          `]);`
        );
      if (callIndex === 1)
        return `const t = todoRead();\ndisplay("count=" + t.items.length + " first=" + t.items[0].status);`;
      return '';
    });
    const r = await runSession({
      streamFn: m,
      message: 'go',
      continueWith: ['read'],
      systemSpaceDirs: [todoSpace, fsSpace],
    });
    expect(r.error).toBeUndefined();
    // todoWrite display()s a markdown checklist.
    expect(r.displays.some((d) => String(d).includes('[x] step one'))).toBe(true);
    expect(r.displays.some((d) => String(d).includes('[~] step two'))).toBe(true);
    expect(r.displays).toContain('count=2 first=completed');
  });
});

// ---------------------------------------------------------------------------
// History summarization across continue()
// ---------------------------------------------------------------------------

describe('harness — history summarization', () => {
  it('collapses old turns once history grows past the threshold', async () => {
    // Each turn is one non-yielding display = 2 messages (user task + assistant).
    // The summarizer keeps the last 6 verbatim, so a collapse only actually happens
    // once there are MORE than 6 messages to summarize away — drive enough turns to
    // cross that, with a low maxHistoryTurns so the threshold itself is met early.
    const m = createMockStreamFn(() => 'display("tick");');
    const r = await runSession({
      streamFn: m,
      message: 't0',
      continueWith: ['t1', 't2', 't3', 't4', 't5', 't6'],
      maxHistoryTurns: 2,
    });
    expect(r.error).toBeUndefined();
    expect(r.displays).toEqual(Array(7).fill('tick'));
    // The deterministic summarizer logs when it collapses history.
    expect(r.logs.some((l) => l.includes('history summarized'))).toBe(true);
  });

  it('does not summarize when maxHistoryTurns is unset (default off)', async () => {
    const m = createMockStreamFn(() => 'display("tick");');
    const r = await runSession({
      streamFn: m,
      message: 't0',
      continueWith: ['t1', 't2', 't3', 't4', 't5', 't6'],
    });
    expect(r.error).toBeUndefined();
    expect(r.logs.some((l) => l.includes('history summarized'))).toBe(false);
  });
});

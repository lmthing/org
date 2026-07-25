/**
 * runner.test.mjs — `bootstrap: thing` project discovery + resume-carry.
 *
 * Regression: e4f1b15 taught the runner that a `bootstrap: thing` scenario must NOT pre-create its
 * project — THING starts in the shared `user` project, must call `createProject` itself, and the
 * runner discovers whatever project appears (never `system`/`user`) and rebinds every later step into
 * it. The very next commit (b7b4bae, the per-run-isolation rewrite) silently dropped that whole code
 * path while restructuring `run()` around per-run servers + snapshots — `grep bootstrap
 * scenarios/lib/runner.mjs` went from one match to zero. This suite pins the behaviour back down so a
 * future refactor of `run()` cannot drop it again without a red test.
 *
 * `Pod`, `ThingSession` and every `local.mjs` server-lifecycle export are faked — this suite is about
 * the ORCHESTRATION in `runner.mjs` (when does it call `createProject`, when does it rebind), not
 * about a real pod or a real QuickJS turn. State shared between the `vi.mock` factories and the test
 * bodies is built inside `vi.hoisted()` — the factories are hoisted above the rest of the module, so
 * anything they close over must be created there too (plain `let`s declared later would be a TDZ trap).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const H = vi.hoisted(() => {
  // A shared mutable registry the fakes read/write so a test can script "THING's turn just created a
  // project" without touching the real Pod/ThingSession wire protocol.
  const state = {
    projects: ['user', 'system'],
    createProjectCalls: [],
    sessionsCreated: [], // [{projectId}] — one per `new ThingSession(...)`, in construction order
    runJsonByRunId: new Map(),
    bumpCalls: [], // [{runId, stepCount, extra}]
    bootWaits: [], // [{projectId, resumeSessionId}] — one per `waitBootReady` on a resume path
    seedDir: null, // an existing dir `snapshotDir` returns, so the runner's existsSync check passes
  };

  function reset() {
    state.projects = ['user', 'system'];
    state.createProjectCalls = [];
    state.sessionsCreated = [];
    state.runJsonByRunId = new Map();
    state.bumpCalls = [];
    state.bootWaits = [];
  }

  class FakePod {
    constructor(opts) {
      this.opts = opts;
    }
    async createProject(name) {
      state.createProjectCalls.push(name);
      if (!state.projects.includes(name)) state.projects.push(name);
      return { id: name };
    }
    async listProjects() {
      return { projects: state.projects.map((id) => ({ id })) };
    }
    async listSpaces() {
      return { spaces: [] };
    }
    async appManifest() {
      return null;
    }
    async appData() {
      return { rows: [] };
    }
    async appBuild() {
      return { built: true, routes: [] };
    }
    // Deliberately DISAGREES with appBuild — that is the real shape (esbuild bundles an app the
    // typecheck rejects), and `open_app` must surface the stricter verdict rather than the rosier one.
    async appCheck() {
      return { ok: false, built: true, routes: [], errors: [{ phase: 'typecheck', file: 'pages/x.tsx', line: 3, message: "Cannot find name 'document'." }] };
    }
    async appPage() {
      return { status: 200 };
    }
    async upload() {
      return { id: 'up1', kind: 'file', mediaType: 'text/plain' };
    }
  }

  class FakeThingSession {
    constructor(pod, opts = {}) {
      this.pod = pod;
      this.projectId = opts.projectId;
      state.sessionsCreated.push({ projectId: opts.projectId });
    }
    async start() {
      return 'fake-session-id';
    }
    /**
     * The runner calls this on every RESUME path (`runner.mjs`, `if (this.resumeFrom)`), so its
     * absence here failed only the two resume cases and left the other six green — which is why the
     * double drifted from `harness/lib/thing.mjs` unnoticed. Recording the calls rather than
     * no-op'ing, so a resume that stops waiting for boot is a visible failure and not a silent one.
     */
    async waitBootReady({ resumeSessionId } = {}) {
      state.bootWaits.push({ projectId: this.projectId, resumeSessionId });
    }
    async syncToTail() {}
    async send(content) {
      // Mimic THING's "yes please" turn calling createProject for its own dedicated project — the
      // fake stands in for a real QuickJS turn that would do the same via the `createProject` global.
      if (/yes please/i.test(content) && this.projectId === 'user') {
        await this.pod.createProject('discovered-trip');
      }
      return {
        durationMs: 1,
        events: [],
        text: `reply to: ${content}`,
        lastText: `reply to: ${content}`,
        yields: [],
        delegates: [],
        errors: [],
        tokens: { in: 0, out: 0 },
        llmCalls: 0,
        nodes: [],
        interrupted: false,
      };
    }
    async sendWithAttachments(content) {
      return this.send(content);
    }
    stats() {
      return { events: 0, llmCalls: 0, tokens: { in: 0, out: 0 }, errors: 0, unrecoveredErrors: 0, delegates: [], yieldKinds: [] };
    }
  }

  return { state, reset, FakePod, FakeThingSession };
});

vi.mock('../harness/lib/pod.mjs', () => ({ Pod: H.FakePod }));
vi.mock('../harness/lib/thing.mjs', () => ({ ThingSession: H.FakeThingSession }));
vi.mock('../harness/provision.mjs', () => ({ getUser: async () => ({ pod: 'http://fake', token: 'tok' }) }));

// A fake per-run lifecycle: no real server, no real snapshot — just enough state-passing for the
// resume path (`readRunJson`) to matter. `H.state.runJsonByRunId` lets a test seed what a PRIOR run
// "recorded".
vi.mock('../harness/lib/local.mjs', () => ({
  reapOrphanRuns: () => {},
  nextRunId: () => 1,
  startRun: async ({ runId, projectId }) => ({
    runId,
    dir: '/fake/run-dir',
    dataDir: '/fake/run-dir/data',
    port: 1,
    base: 'http://fake',
    logFile: '/fake/run-dir/sessions.log',
    projectId,
  }),
  stopRun: () => {},
  restartRun: async (run) => run,
  snapshotProject: () => '/fake/run-dir/snapshots/step-00',
  snapshotDir: () => H.state.seedDir,
  bumpCompletedSteps: (run, stepCount, extra = {}) => {
    H.state.bumpCalls.push({ runId: run.runId, stepCount, extra });
    const cur = H.state.runJsonByRunId.get(run.runId) ?? {};
    H.state.runJsonByRunId.set(run.runId, { ...cur, completedSteps: stepCount, ...extra });
  },
  latestSessionId: () => null,
  readRunJson: (_scenarioDir, runId) => {
    const j = H.state.runJsonByRunId.get(runId);
    if (!j) throw new Error(`no fake run.json for run ${runId}`);
    return j;
  },
}));

const { ScenarioRunner, sendResilient } = await import('./runner.mjs');

const tmps = [];
const mkTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'lmscn-runner-'));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const bootstrapScenario = { id: 'fake-bootstrap', project: 'nominal-name', bootstrap: 'thing' };
const plainScenario = { id: 'fake-plain', project: 'nominal-name' };
const twoSteps = [
  { say: 'here is my mess', expect: [] },
  { say: 'Yes please.', expect: [] },
];

describe('bootstrap: thing — the runner pre-creates NOTHING', () => {
  it('never calls createProject before THING makes its own', async () => {
    H.reset();
    const scenarioDir = mkTmp();
    const runner = new ScenarioRunner({ scenario: bootstrapScenario, steps: twoSteps, scenarioDir, fixturesDir: scenarioDir, projectId: 'nominal-name', outDir: mkTmp() });
    await runner.run();
    expect(H.state.createProjectCalls).not.toContain('nominal-name');
  });

  it('a NON-bootstrap scenario keeps pre-creating its nominal project (unchanged behaviour)', async () => {
    H.reset();
    const scenarioDir = mkTmp();
    const runner = new ScenarioRunner({ scenario: plainScenario, steps: twoSteps, scenarioDir, fixturesDir: scenarioDir, projectId: 'nominal-name', outDir: mkTmp() });
    await runner.run();
    expect(H.state.createProjectCalls).toContain('nominal-name');
  });
});

describe('bootstrap: thing — discovery + rebind', () => {
  it('starts THING in `user`, discovers the project it creates, and rebinds subsequent steps into it', async () => {
    H.reset();
    const scenarioDir = mkTmp();
    const outDir = mkTmp();
    const runner = new ScenarioRunner({ scenario: bootstrapScenario, steps: twoSteps, scenarioDir, fixturesDir: scenarioDir, projectId: 'nominal-name', outDir });
    const { results } = await runner.run();

    // Step 1: nothing created yet — the first-ever session was bound to `user`.
    expect(H.state.sessionsCreated[0]).toEqual({ projectId: 'user' });
    expect(results[0].createdProject).toBeUndefined();

    // Step 2: THING's "yes please" turn created "discovered-trip" — the runner must have found it
    // (never `user`/`system`) and rebound into a FRESH session scoped to it.
    expect(results[1].createdProject).toBe('discovered-trip');
    expect(results[1].state).toBeDefined();
    expect(H.state.sessionsCreated.some((s) => s.projectId === 'discovered-trip')).toBe(true);

    // `user` must stay clean — proof the app landed in the new project, not the shared home.
    expect(results[1].userProjectClean).toBe(true);

    // The discovered project is persisted into run.json so a LATER --resume can read it back.
    const lastBump = H.state.bumpCalls.at(-1);
    expect(lastBump.extra.projectId).toBe('discovered-trip');
    expect(lastBump.extra.createdProject).toBe('discovered-trip');
  });

  it('resuming BEFORE discovery (still `user`) rediscovers on replay — same as a fresh run', async () => {
    H.reset();
    const scenarioDir = mkTmp();
    H.state.seedDir = mkTmp(); // must exist — the runner existsSync-checks it
    // A prior run completed step 1 with nothing created yet.
    H.state.runJsonByRunId.set(1, { projectId: 'user', createdProject: null, completedSteps: 1, stepCount: 2 });

    const runner = new ScenarioRunner({
      scenario: bootstrapScenario,
      steps: twoSteps,
      scenarioDir,
      fixturesDir: scenarioDir,
      projectId: 'nominal-name',
      resumeFrom: { runId: 1, from: 1 },
      outDir: mkTmp(),
    });
    const { results } = await runner.run();

    // Only step 2 replays (`from: 1` = resume after step 1) and it's the one that creates the project.
    expect(results).toHaveLength(1);
    expect(H.state.sessionsCreated[0]).toEqual({ projectId: 'user' }); // resumed bound to `user`, not a guess
    expect(results[0].createdProject).toBe('discovered-trip');
    // A resume MUST wait for the pod to finish booting before replaying, or the first message races
    // the boot and 404s. Asserted, not just tolerated: this double silently lacked `waitBootReady`
    // until now, so the call being made is exactly what went unnoticed.
    expect(H.state.bootWaits).toHaveLength(1);
  });

  it('resuming AFTER discovery binds straight into the real project — never restarts in `user`', async () => {
    H.reset();
    const scenarioDir = mkTmp();
    H.state.seedDir = mkTmp();
    // A prior run already discovered its project by the end of step 2.
    H.state.runJsonByRunId.set(1, { projectId: 'discovered-trip', createdProject: 'discovered-trip', completedSteps: 2, stepCount: 3 });
    H.state.projects.push('discovered-trip'); // it exists on the seeded disk already

    const threeSteps = [...twoSteps, { say: 'one more thing', expect: [] }];
    const runner = new ScenarioRunner({
      scenario: bootstrapScenario,
      steps: threeSteps,
      scenarioDir,
      fixturesDir: scenarioDir,
      projectId: 'nominal-name',
      resumeFrom: { runId: 1, from: 2 },
      outDir: mkTmp(),
    });
    const { results } = await runner.run();

    // The very first session of the resumed run must be bound to the REAL project immediately — a
    // session started against `user` here would miss the persisted conversation entirely (the gap
    // this fix closes: before it, bootstrap discovery didn't exist at all, so a resume of a
    // `bootstrap: thing` scenario had no way to know its project wasn't the nominal `project:` id).
    expect(H.state.sessionsCreated[0]).toEqual({ projectId: 'discovered-trip' });
    expect(results).toHaveLength(1);
    expect(results[0].createdProject).toBeUndefined(); // already known — no re-discovery bookkeeping
    // Same contract as the previous case: a resume waits for boot before replaying, and it waits on
    // the session bound to the REAL project.
    expect(H.state.bootWaits).toHaveLength(1);
    expect(H.state.bootWaits[0].projectId).toBe('discovered-trip');
  });
});

// Option C made the live app-build target DURABLE across a session re-establish (SessionManager
// persists `buildTargetProjectId` + re-seeds the holder on resume), so the harness no longer needs
// to re-issue an interrupted turn to rebuild it. `sendResilient` is now an HONEST pass-through and
// a genuine mid-turn vanish throws from `ThingSession` instead of coming back as a completed-but-
// `interrupted` turn this loop would silently re-run. These pin that no-re-send contract.
describe('sendResilient — honest pass-through (no re-send on interrupt)', () => {
  it('returns the turn as-is when it did not interrupt (one send, no note)', async () => {
    const rec = { notes: [] };
    let calls = 0;
    const turn = await sendResilient(() => { calls++; return Promise.resolve({ ok: true }); }, rec);
    expect(calls).toBe(1);
    expect(turn).toEqual({ ok: true });
    expect(rec.notes).toEqual([]);
  });

  it('does NOT re-send an interrupted turn — it passes the interrupt straight through, ONCE', async () => {
    const rec = { notes: [] };
    let calls = 0;
    const turn = await sendResilient(() => { calls++; return Promise.resolve({ interrupted: true }); }, rec);
    expect(calls).toBe(1); // sent exactly once — no replay of the eviction
    expect(turn).toEqual({ interrupted: true }); // surfaced honestly, not masked as a recovery
    expect(rec.notes).toEqual([]); // no "re-sent" note — there was no re-send
  });

  it('is a thin wrapper: whatever the fn resolves is returned unchanged, with no bookkeeping', async () => {
    const rec = { notes: [] };
    let calls = 0;
    const turn = await sendResilient(() => { calls++; return Promise.resolve({ ok: true, built: true }); }, rec);
    expect(calls).toBe(1);
    expect(turn).toEqual({ ok: true, built: true });
    expect(rec.notes).toEqual([]);
  });
});

/**
 * runner.mjs — the reentrant scenario engine.
 *
 * `ScenarioRunner.run()` plays a scenario's steps against a PER-RUN local `lmthing serve` and writes
 * per-step EVIDENCE (`step-NN.full.json` raw · `step-NN.json` compact · `trace.md` · `summary.json`)
 * for the JUDGE, INTO the run's own directory.
 *
 * Every run is isolated: it owns a uniquely-numbered dir `<scenarioDir>/runs/<runId>/`, its own
 * `lmthing serve` (own data dir + own port), and — at the end of each step — a SNAPSHOT of its
 * project files under `runs/<runId>/snapshots/step-NN/`. A rerun (`resumeFrom`) seeds a fresh run's
 * data dir from a chosen snapshot and continues from the next step, so expensive earlier steps are
 * never replayed. The server dies WITH the run: `stopRun` on every exit path, plus signal handlers so
 * a killed run-scenario always takes its server down.
 *
 * The one seam is `reporter` — an optional bag of callbacks the CLI shim uses to print its exact
 * `[run-scenario]` stdout markers. Default is no-op, so an embedding caller runs silently.
 */
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';
import {
  startRun,
  stopRun,
  restartRun,
  snapshotProject,
  snapshotDir,
  bumpCompletedSteps,
  latestSessionId,
  nextRunId,
  reapOrphanRuns,
  readRunJson,
  mutateTableSchema,
} from '../harness/lib/local.mjs';
import { applyEnv, readEnvVar } from '../harness/lib/env.mjs';
import { signHmac } from '../harness/lib/webhook-sign.mjs';
import { getUser } from '../harness/provision.mjs';
import { snapshot, summarizeTurn, compactStep, traceLines, compact, deadTurnError } from './evidence.mjs';
import { StepAsks } from './asks.mjs';
import { FatalError } from './errors.mjs';

export { FatalError } from './errors.mjs';

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Execute one step's verbs against a (possibly faked) pod/session, mutating `rec` in place.
 * Returns the `ThingSession` the NEXT step should use — unchanged unless `fresh_session` replaced
 * it (a step's OWN `space_session` diversion is scoped to just this step and never leaks forward).
 *
 * Extracted from the run loop so the verb dispatch is directly unit-testable against fake
 * pod/session doubles, independent of booting a real per-run server (see `runner-verbs.test.mjs`).
 * `projectId` is whatever project the CALLER currently considers active (for a `bootstrap: thing`
 * scenario that is `activeProjectId`, rebound once THING creates its own project) — this function
 * stays agnostic to that discovery dance, it just targets whichever id it's given.
 *
 * @param {object} o
 * @param {object} o.step
 * @param {import('../harness/lib/thing.mjs').ThingSession} o.thing  the project's main session
 * @param {import('../harness/lib/pod.mjs').Pod} o.pod
 * @param {{dataDir: string}} o.run          needed only by `mutate_schema`/`restart_pod`/`fresh_session`
 * @param {string} o.projectId
 * @param {string} o.fixturesDir
 * @param {object} o.rec                     the step's evidence record (mutated in place)
 * @param {Array<string>} o.envStack         LIFO of pre-mutation `.env` contents, for `restore_env`
 * @param {(descriptor:object)=>unknown} o.onAsk
 * @param {boolean} o.verbose
 */
/**
 * Send a turn — an HONEST pass-through (no re-send).
 *
 * This used to re-issue a turn that came back `interrupted` (a mid-turn session eviction), because
 * the in-RAM app-build target THING retargets to (`createProject`/`selectProject`) was LOST on a
 * session re-establish, so a replay was the only way to rebuild into the right project. That target
 * is now DURABLE across a re-establish: `SessionManager` persists `buildTargetProjectId` in the
 * session meta and re-seeds the live holder on resume (see
 * `sdk/org/libs/cli/src/server/session-manager.ts` — `persistSession` + `defaultBuildSession`). A
 * re-established session therefore already points at the same live project, so there is nothing to
 * replay. A genuine mid-turn vanish now surfaces as an HONEST failure — `ThingSession` THROWS
 * (harness/lib/thing.mjs) rather than masking it as a completed-but-`interrupted` turn that this
 * loop would silently re-run. Kept as a thin wrapper so the call sites read unchanged and the
 * eviction contract has one documented home; `rec` is unused now (no re-send note to record).
 */
export async function sendResilient(fn, _rec) {
  return await fn();
}

export async function runStep({ step, thing, pod, run, projectId, fixturesDir, rec, envStack, onAsk, verbose }) {
  // ── host-side, out-of-band actions that land BEFORE anything else this step does ──────────────
  if (step.set_env) {
    const { keys, previousContent } = await applyEnv(pod, step.set_env);
    envStack.push(previousContent);
    rec.setEnv = { keys };
  }
  if (step.blank_env) {
    const updates = Object.fromEntries(step.blank_env.map((k) => [k, '']));
    const { keys, previousContent } = await applyEnv(pod, updates);
    envStack.push(previousContent);
    rec.blankEnv = { keys };
  }
  if (step.mutate_schema) {
    rec.mutateSchema = mutateTableSchema(run, projectId, step.mutate_schema.table, step.mutate_schema.change);
  }

  if (step.fresh_session) {
    thing = new ThingSession(pod, { projectId, onAsk, verbose });
    await thing.start();
    await thing.syncToTail();
    rec.notes.push('started a fresh session (zero history)');
  }
  if (step.restart_pod) {
    rec.notes.push('restarting local server…');
    await restartRun(run);
    rec.notes.push('server back up');
  }

  // Which session drives this step's say/then_say — `space_session` diverts to a SCOPED probe
  // bound to one space's own agent (bypassing THING), for exactly this step; `thing` itself is
  // untouched, so the NEXT step is back on the general dock.
  let sess = thing;
  if (step.space_session) {
    sess = new ThingSession(pod, { projectId, spaceRef: step.space_session, onAsk, verbose });
    await sess.start();
    await sess.syncToTail();
    rec.spaceSession = step.space_session;
  }

  if (step.say != null) {
    let turn;
    if (Array.isArray(step.attach) && step.attach.length) {
      const refs = [];
      for (const f of step.attach) {
        const p = join(fixturesDir, f);
        if (!existsSync(p)) {
          rec.notes.push(`MISSING FIXTURE: ${f}`);
          continue;
        }
        refs.push(await pod.upload(p));
      }
      rec.attached = step.attach;
      turn = await sendResilient(() => sess.sendWithAttachments(step.say, refs), rec);
    } else {
      turn = await sendResilient(() => sess.send(step.say), rec);
    }
    rec.turns.push(summarizeTurn(turn, step.space_session ? `[${step.space_session}] ${step.say}` : step.say));
  }
  if (step.then_say != null) {
    const t = await sendResilient(() => sess.send(step.then_say), rec);
    rec.turns.push(summarizeTurn(t, step.space_session ? `[${step.space_session}] ${step.then_say}` : step.then_say));
  }
  if (step.in_app_chat != null) {
    const t = await thing.send(step.in_app_chat);
    rec.turns.push(summarizeTurn(t, `[in-app] ${step.in_app_chat}`));
  }
  if (step.open_app) {
    const build = await pod.appBuild(projectId).catch((e) => ({ error: String(e?.message ?? e) }));
    rec.appBuild = { built: build?.built ?? build?.build?.built ?? null, routes: build?.routes ?? null, error: build?.error ?? null };
    // `appBuild` is esbuild-only: it answers `built:true` for an app that fails typecheck (run 34
    // of 06-tanzania reported exactly that while 4 real type errors stood). Ask for the
    // authoritative verdict too, so a step can never pass on a build the pod itself calls broken.
    const check = await pod.appCheck(projectId).catch((e) => ({ error: String(e?.message ?? e) }));
    rec.appCheck = {
      ok: check?.ok ?? null,
      errorCount: Array.isArray(check?.errors) ? check.errors.length : null,
      errors: Array.isArray(check?.errors) ? check.errors.slice(0, 10) : null,
      error: check?.error ?? null,
    };
    const page = await pod.appPage(projectId).catch((e) => ({ error: String(e?.message ?? e) }));
    rec.appPageStatus = page?.status ?? (page?.error ? `error: ${page.error}` : 'ok');
    rec.notes.push('opened app (built + fetched root page; browser render is the judge\'s job)');
  }

  // ── DIRECT pod probes — 0 LLM calls, exactly the "direct, no LLM call" beats 08/09/10 need ─────
  if (step.call_app_api) {
    const { method, path, body } = step.call_app_api;
    const res = await pod.appApi(projectId, path, body, method ?? 'POST');
    rec.callAppApi = { method: method ?? 'POST', path, status: res.status, body: compact(res.body) };
  }
  if (step.run_emitter) {
    const spec = step.run_emitter;
    if (typeof spec === 'string') {
      // A bare string is a PLAIN hook's own file-based slug (an old-style `hooks/*.ts` cron def,
      // e.g. `trigger: '<space>/agent#action'`) — run directly, no `@emitter:` wrapper.
      const result = await pod.runHook(projectId, spec);
      rec.runEmitter = { slug: spec, result: compact(result) };
    } else if (spec.slug) {
      const result = await pod.runHook(projectId, spec.slug, spec.payload ?? {});
      rec.runEmitter = { slug: spec.slug, result: compact(result) };
    } else {
      // `{scope, name}` is a `type:'cron'` EMITTER DEF declared in an `events/*.ts` manifest
      // (project- or space-scoped) — fired via the `@emitter:<scope>:<name>` pseudo-slug.
      const result = await pod.runEmitter(projectId, spec.scope, spec.name, spec.payload);
      rec.runEmitter = { scope: spec.scope, name: spec.name, result: compact(result) };
    }
  }
  if (step.inbound) {
    // One delivery, or several (a multi-check beat, or a concurrent burst) — always fired via
    // Promise.all: each delivery's assertions (status code, presence in the FINAL state snapshot)
    // are independent of the others' ordering.
    const list = Array.isArray(step.inbound) ? step.inbound : [step.inbound];
    const deliveries = await Promise.all(
      list.map(async (d) => {
        const headers = { ...(d.headers ?? {}) };
        if (d.sign) {
          // The secret is only known at RUN time (set via `set_env`, or already in the pod's env) —
          // read it fresh right before signing so the yaml never bakes in a precomputed signature.
          const secret = await readEnvVar(pod, d.sign.secretEnv);
          const raw = typeof d.body === 'string' ? d.body : JSON.stringify(d.body ?? {});
          headers[d.sign.header] = signHmac(secret, raw, d.sign);
        }
        const res = await pod.inbound(d.path, d.body, headers);
        // Header NAMES only, matching set_env's own credential hygiene — a signature is a secret.
        return { path: d.path, headerNames: Object.keys(headers), status: res.status, body: compact(res.body) };
      }),
    );
    rec.inbound = deliveries;
  }
  if (step.list_integrations) {
    const t0 = Date.now();
    rec.integrations = await pod.listIntegrations(projectId);
    rec.integrationsMs = Date.now() - t0;
  }

  // `restore_env` runs LAST so ONE step can do `blank_env` → `say` → `restore_env` atomically —
  // undoing the SAME step's own mutation once the turn that needed the outage has run, before the
  // NEXT step ever sees the pod.
  if (step.restore_env) {
    const previousContent = envStack.pop();
    if (previousContent !== undefined) {
      await pod.putEnv(previousContent);
      rec.restoreEnv = { restored: true };
    } else {
      rec.notes.push('restore_env: no prior env snapshot on the stack — nothing to restore');
    }
  }

  return thing;
}

export class ScenarioRunner {
  constructor({
    scenario,
    steps,
    scenarioDir,
    fixturesDir,
    projectId,
    runId,
    resumeFrom = null,
    seedDir = null,
    seedProject = null,
    outDir,
    through,
    keepServer = false,
    keepProject = false,
    purge = false,
    verbose = false,
    reporter = {},
  }) {
    this.scenario = scenario;
    this.steps = steps ?? [];
    this.scenarioDir = scenarioDir;
    this.fixturesDir = fixturesDir;
    this.projectId = projectId;
    this.runId = runId;
    this.resumeFrom = resumeFrom; // { runId, from? } | null
    // Repro mode: seed real STATE from a snapshot-shaped dir but start a FRESH session (no history
    // reconnect) — reproduces a bug from state alone, sidestepping the broken session-resume path.
    this.seedDir = seedDir; // absolute path to a snapshot-shaped seed dir | null
    this.seedProject = seedProject; // the project id inside the seed
    this.outDir = outDir;
    this.through = through ?? this.steps.length;
    this.keepServer = keepServer;
    this.keepProject = keepProject;
    this.purge = purge;
    this.verbose = verbose;
    this.reporter = reporter ?? {};
    this.asks = new StepAsks();
    this.traceMd = [];
  }

  log(...a) {
    if (this.verbose) console.log('[run-scenario]', ...a);
  }

  /** Play the scenario; returns { runId, ranSteps, ofSteps, outDir, results, summary }. */
  async run() {
    const { scenario, steps, scenarioDir, fixturesDir, through } = this;
    // Reap any server left behind by an untrappable SIGKILL of a prior run-scenario (owner pid dead).
    reapOrphanRuns(scenarioDir);

    // `bootstrap: thing` — THING starts in the shared `user` project and must CREATE its OWN
    // dedicated project (createProject) and build into it; the runner pre-creates NOTHING. Once
    // THING's turn produces a new project, we discover it (below, after each step) and rebind every
    // subsequent step into it — mirroring the real UX (create in `user`, then work in the new
    // project). `projectId` stays the scenario's NOMINAL name (only used to pre-create a project for
    // non-bootstrap scenarios); `activeProjectId` is the project every step actually runs against.
    const bootstrapByThing = scenario.bootstrap === 'thing';

    // Resolve the resume seed + where the step loop starts.
    let projectId = this.projectId;
    let activeProjectId = bootstrapByThing ? 'user' : projectId;
    let createdProjectId = null;
    let seedFrom = null;
    let startIndex = 0;
    if (this.resumeFrom) {
      const src = readRunJson(scenarioDir, this.resumeFrom.runId);
      projectId = src.projectId; // match the snapshot's project
      // The snapshot may predate discovery (still `user`) or postdate it (the real project THING
      // made) — `src.projectId`/`src.createdProject` (persisted every step, below) is ground truth
      // for where to resume, never a re-guess at `user`.
      activeProjectId = bootstrapByThing ? src.projectId : projectId;
      if (bootstrapByThing) createdProjectId = src.createdProject ?? (src.projectId !== 'user' ? src.projectId : null);
      const fromStep = this.resumeFrom.from ?? src.completedSteps ?? 0;
      if (fromStep >= 1) {
        seedFrom = snapshotDir(scenarioDir, this.resumeFrom.runId, fromStep);
        if (!existsSync(seedFrom)) throw new FatalError(`no snapshot at ${seedFrom} — run ${this.resumeFrom.runId} did not complete step ${fromStep}`);
        startIndex = fromStep;
      }
      if (steps.length !== (src.stepCount ?? steps.length)) {
        this.log(`⚠️ resume: current scenario has ${steps.length} steps but run ${this.resumeFrom.runId} recorded ${src.stepCount} — step numbers may have shifted`);
      }
    } else if (this.seedDir) {
      // Repro seed: copy the state (the seed dir is snapshot-shaped) but leave the session fresh —
      // `resumeFrom` is null, so `resumeSessionId` stays null below and the project has no history.
      if (!existsSync(this.seedDir)) throw new FatalError(`no seed dir at ${this.seedDir}`);
      seedFrom = this.seedDir;
      activeProjectId = this.seedProject ?? projectId;
      projectId = activeProjectId;
    }

    const runId = this.runId ?? nextRunId(scenarioDir);
    const run = await startRun({ scenarioDir, runId, projectId: activeProjectId, scenarioId: scenario.id, seedFrom });
    this.reporter.onRunStart?.({ runId, runDir: run.dir, port: run.port, base: run.base, resumeFrom: this.resumeFrom, seedFrom });

    // Evidence + runner.pid live in the run dir by default (a self-contained run); --out overrides.
    const outDir = this.outDir ?? run.dir;
    mkdirSync(outDir, { recursive: true });
    this.log(`scenario ${scenario.id} · run ${runId} · project ${projectId} · steps ${startIndex + 1}..${through}/${steps.length}`);

    // The RUNNER owns its own PID file: a stopper does `kill $(cat <out>/runner.pid)`.
    const pidFile = join(outDir, 'runner.pid');
    writeFileSync(pidFile, String(process.pid));

    // Teardown is UNCONDITIONAL on kill: when run-scenario is signalled, its server is always killed too.
    // `--keep-server` only spares the server on NORMAL completion (via the finally below).
    const killServer = () => { try { stopRun(run); } catch { /* already gone */ } };
    const onExit = () => { if (!this.keepServer) killServer(); try { rmSync(pidFile, { force: true }); } catch { /* ignore */ } };
    const onSignal = (code) => () => { killServer(); process.exit(code); };
    const sigHandlers = { SIGINT: onSignal(130), SIGTERM: onSignal(143), SIGHUP: onSignal(129), SIGQUIT: onSignal(131) };
    process.on('exit', onExit);
    for (const [sig, h] of Object.entries(sigHandlers)) process.on(sig, h);

    this.reporter.onPid?.({ pid: process.pid, pidFile });

    // Clean stale evidence from a REUSED --out dir so a poller can't read a prior run's files.
    for (const f of readdirSyncSafe(outDir)) {
      if (/^step-\d+(\.full)?\.json$/.test(f) || f === 'summary.json' || f === 'trace.md') {
        try { rmSync(join(outDir, f), { force: true }); } catch { /* ignore */ }
      }
    }

    const results = [];
    // A LIFO of pre-mutation `.env` contents — `set_env`/`blank_env` push, `restore_env` pops (see
    // `runStep`). Lives for the whole run so a step's restore can outlive its own step boundary.
    const envStack = [];
    let thing;
    try {
      const user = await getUser(scenario.id, { localBase: run.base });
      const pod = new Pod({ base: user.pod, token: user.token, onLocalRestart: () => restartRun(run) });

      // Fresh run → create the project (unless THING must create its own via `bootstrap: thing`).
      // Resume / repro-seed → the project came in with the snapshot.
      if (!this.resumeFrom && !this.seedDir && !bootstrapByThing) {
        try {
          await pod.createProject(projectId);
        } catch (e) {
          this.log(`createProject(${projectId}) — ${String(e?.message ?? e)} (continuing; may already exist)`);
        }
      }

      // On resume, reconnect to the THING session the snapshot captured so a follow-up ("yes, go for
      // it") keeps its conversational context; on a fresh run, a clean session. Either way the
      // project (spaces/app/db) is on disk, so the session sees everything built so far.
      const resumeSessionId = this.resumeFrom ? latestSessionId(run, activeProjectId) : null;
      thing = new ThingSession(pod, { projectId: activeProjectId, onAsk: this.asks.onAsk, verbose: this.verbose });
      await thing.start(resumeSessionId ? { resumeSessionId } : {});
      // A resumed pod seeds a whole built project; its boot (db-warm + overdue-cron agent turns on the
      // single Node thread) can starve the first session probe so the just-created session appears to
      // "disappear before doing any work". Wait for boot to settle (re-establishing if it dropped the
      // session) BEFORE the first step, so a heavy --from 3 resume no longer dies at the first turn.
      if (this.resumeFrom) await thing.waitBootReady({ resumeSessionId });
      if (resumeSessionId) await thing.syncToTail();

      for (let n = startIndex; n < Math.min(through, steps.length); n++) {
        const step = steps[n];
        this.asks.begin(step);
        const num = n + 1;
        const rec = { step: num, verbs: Object.keys(step).filter((k) => k !== 'expect'), expect: step.expect ?? [], turns: [], asks: [], notes: [] };
        this.log(`── step ${num}: ${rec.verbs.join(', ')}`);

        try {
          thing = await runStep({ step, thing, pod, run, projectId: activeProjectId, fixturesDir, rec, envStack, onAsk: this.asks.onAsk, verbose: this.verbose });
        } catch (e) {
          rec.error = String(e?.stack ?? e?.message ?? e);
          rec.notes.push(`STEP THREW: ${rec.error.split('\n')[0]}`);
        }

        const dead = deadTurnError(rec);
        if (dead) {
          rec.error = dead;
          rec.notes.push(`STEP THREW: ${dead}`);
        }

        // bootstrap:thing — after THING has had a turn, discover the project it created and rebind
        // the remaining steps into it. A brand-new project appearing (never `user`/`system`) IS the
        // feature working; the app + data live there, so every read/write below must target it.
        if (bootstrapByThing && !createdProjectId) {
          const projs = (await pod.listProjects().catch(() => ({ projects: [] }))).projects.map((p) => p.id ?? p);
          const found = projs.find((id) => id !== 'system' && id !== 'user');
          if (found) {
            createdProjectId = found;
            activeProjectId = found;
            rec.createdProject = found;
            rec.notes.push(`THING created a dedicated project "${found}" (NOT user) — rebinding subsequent steps into it`);
            // Prove the app did NOT land in `user`: user must have no app tables/pages of its own.
            const userState = await snapshot(pod, 'user').catch(() => null);
            const uTables = userState?.appManifest?.tables?.length ?? 0;
            const uPages = userState?.appManifest?.pages?.length ?? 0;
            rec.userProjectClean = uTables === 0 && uPages === 0;
            if (!rec.userProjectClean) rec.notes.push('WARNING: the `user` project has app tables/pages — THING built into user (FAILURE)');
            thing = new ThingSession(pod, { projectId: found, onAsk: this.asks.onAsk, verbose: this.verbose });
            await thing.start();
          }
        }

        rec.asks = this.asks.drain();
        // `projectRoot` unlocks the view-spec facts (see evidence.mjs's docblock) — cheap and
        // additive: a non-viewbuilder project (no `.view.json` anywhere) still costs one `readdir`.
        rec.state = await snapshot(pod, activeProjectId, { projectRoot: join(run.dataDir, '.lmthing', activeProjectId) });
        // Snapshot the project files so a later --resume can seed from here and continue.
        rec.snapshot = snapshotProject(run, num);
        bumpCompletedSteps(run, num, { stepCount: steps.length, projectId: activeProjectId, createdProject: createdProjectId });
        this.reporter.onSnapshot?.({ step: num, dir: rec.snapshot });

        results.push(rec);
        const stem = join(outDir, `step-${String(num).padStart(2, '0')}`);
        writeFileSync(`${stem}.full.json`, JSON.stringify(rec, null, 2));
        writeFileSync(`${stem}.json`, JSON.stringify(compactStep(rec), null, 2));
        this.traceMd.push(...traceLines(rec));
      }
    } finally {
      // Normal-path teardown: kill the server unless the caller asked to keep it up for poking, drop
      // our own pidfile, and detach the signal handlers (so a second run() in one process is clean).
      if (!this.keepServer) killServer();
      try { rmSync(pidFile, { force: true }); } catch { /* ignore */ }
      process.removeListener('exit', onExit);
      for (const [sig, h] of Object.entries(sigHandlers)) process.removeListener(sig, h);
    }

    const summary = {
      scenario: scenario.id,
      run: runId,
      project: activeProjectId,
      ...(bootstrapByThing ? { bootstrap: 'thing', createdProject: createdProjectId } : {}),
      ranSteps: results.length,
      ofSteps: steps.length,
      startedAtStep: startIndex + 1,
      sessionStats: thing?.stats?.() ?? null,
      outDir,
      runDir: run.dir,
      finishedAt: new Date().toISOString(),
    };
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    const tracePath = join(outDir, 'trace.md');
    writeFileSync(tracePath, this.traceMd.join('\n'));
    if (this.purge) {
      try { rmSync(run.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    this.reporter.onDone?.({ runId, ranSteps: results.length, ofSteps: steps.length, outDir, runDir: run.dir, tracePath });
    return { runId, ranSteps: results.length, ofSteps: steps.length, outDir, results, summary };
  }
}

/** Convenience: `new ScenarioRunner(cfg).run()`. */
export function runScenario(cfg) {
  return new ScenarioRunner(cfg).run();
}

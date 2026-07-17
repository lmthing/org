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
} from '../harness/lib/local.mjs';
import { getUser } from '../harness/provision.mjs';
import { snapshot, summarizeTurn, compactStep, traceLines } from './evidence.mjs';
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

export class ScenarioRunner {
  constructor({
    scenario,
    steps,
    scenarioDir,
    fixturesDir,
    projectId,
    runId,
    resumeFrom = null,
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

    // Resolve the resume seed + where the step loop starts.
    let projectId = this.projectId;
    let seedFrom = null;
    let startIndex = 0;
    if (this.resumeFrom) {
      const src = readRunJson(scenarioDir, this.resumeFrom.runId);
      projectId = src.projectId; // match the snapshot's project
      const fromStep = this.resumeFrom.from ?? src.completedSteps ?? 0;
      if (fromStep >= 1) {
        seedFrom = snapshotDir(scenarioDir, this.resumeFrom.runId, fromStep);
        if (!existsSync(seedFrom)) throw new FatalError(`no snapshot at ${seedFrom} — run ${this.resumeFrom.runId} did not complete step ${fromStep}`);
        startIndex = fromStep;
      }
      if (steps.length !== (src.stepCount ?? steps.length)) {
        this.log(`⚠️ resume: current scenario has ${steps.length} steps but run ${this.resumeFrom.runId} recorded ${src.stepCount} — step numbers may have shifted`);
      }
    }

    const runId = this.runId ?? nextRunId(scenarioDir);
    const run = await startRun({ scenarioDir, runId, projectId, scenarioId: scenario.id, seedFrom });
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
    let thing;
    try {
      const user = await getUser(scenario.id, { localBase: run.base });
      const pod = new Pod({ base: user.pod, token: user.token, onLocalRestart: () => restartRun(run) });

      // Fresh run → create the project. Resume → the project came in with the snapshot.
      if (!this.resumeFrom) {
        try {
          await pod.createProject(projectId);
        } catch (e) {
          this.log(`createProject(${projectId}) — ${String(e?.message ?? e)} (continuing; may already exist)`);
        }
      }

      // On resume, reconnect to the THING session the snapshot captured so a follow-up ("yes, go for
      // it") keeps its conversational context; on a fresh run, a clean session. Either way the
      // project (spaces/app/db) is on disk, so the session sees everything built so far.
      const resumeSessionId = this.resumeFrom ? latestSessionId(run, projectId) : null;
      thing = new ThingSession(pod, { projectId, onAsk: this.asks.onAsk, verbose: this.verbose });
      await thing.start(resumeSessionId ? { resumeSessionId } : {});
      if (resumeSessionId) await thing.syncToTail();

      for (let n = startIndex; n < Math.min(through, steps.length); n++) {
        const step = steps[n];
        this.asks.begin(step);
        const num = n + 1;
        const rec = { step: num, verbs: Object.keys(step).filter((k) => k !== 'expect'), expect: step.expect ?? [], turns: [], asks: [], notes: [] };
        this.log(`── step ${num}: ${rec.verbs.join(', ')}`);

        try {
          if (step.fresh_session) {
            thing = new ThingSession(pod, { projectId, onAsk: this.asks.onAsk, verbose: this.verbose });
            await thing.start();
            await thing.syncToTail();
            rec.notes.push('started a fresh session (zero history)');
          }
          if (step.restart_pod) {
            rec.notes.push('restarting local server…');
            await restartRun(run);
            rec.notes.push('server back up');
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
              turn = await thing.sendWithAttachments(step.say, refs);
            } else {
              turn = await thing.send(step.say);
            }
            rec.turns.push(summarizeTurn(turn, step.say));
          }
          if (step.then_say != null) {
            const t = await thing.send(step.then_say);
            rec.turns.push(summarizeTurn(t, step.then_say));
          }
          if (step.in_app_chat != null) {
            const t = await thing.send(step.in_app_chat);
            rec.turns.push(summarizeTurn(t, `[in-app] ${step.in_app_chat}`));
          }
          if (step.open_app) {
            const build = await pod.appBuild(projectId).catch((e) => ({ error: String(e?.message ?? e) }));
            rec.appBuild = { built: build?.built ?? build?.build?.built ?? null, routes: build?.routes ?? null, error: build?.error ?? null };
            const page = await pod.appPage(projectId).catch((e) => ({ error: String(e?.message ?? e) }));
            rec.appPageStatus = page?.status ?? (page?.error ? `error: ${page.error}` : 'ok');
            rec.notes.push('opened app (built + fetched root page; browser render is the judge\'s job)');
          }
        } catch (e) {
          rec.error = String(e?.stack ?? e?.message ?? e);
          rec.notes.push(`STEP THREW: ${rec.error.split('\n')[0]}`);
        }

        rec.asks = this.asks.drain();
        rec.state = await snapshot(pod, projectId);
        // Snapshot the project files so a later --resume can seed from here and continue.
        rec.snapshot = snapshotProject(run, num);
        bumpCompletedSteps(run, num, { stepCount: steps.length });
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
      project: projectId,
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

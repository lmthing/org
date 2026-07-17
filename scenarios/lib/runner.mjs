/**
 * runner.mjs — the reentrant, LOCAL-ONLY scenario engine.
 *
 * `ScenarioRunner.run()` reproduces the old `run-yaml.mjs` `main()` byte-for-byte in what it writes:
 * it plays a scenario's steps against a local `lmthing serve` pod and writes per-step EVIDENCE
 * (`step-NN.full.json` raw · `step-NN.json` compact · `trace.md` · `summary.json`) for the JUDGE.
 *
 * All mutable per-run state (the active step, the ask log, the trace buffer, the project id) is
 * INSTANCE state, so two runners can coexist in one process — the module globals the old script used
 * (`currentStep`/`asksThisStep`) are gone. NOTE: the LOCAL server itself is process-shared and keyed
 * by `LM_LOCAL_PORT`; two concurrent runners in one process must use distinct ports (and distinct
 * project ids), or a `restart_pod` in one will drop the other's in-flight session.
 *
 * The one seam is `reporter` — an optional bag of callbacks the CLI shim uses to print its exact
 * `[run-yaml]` stdout markers. Default is no-op, so an embedding caller runs silently.
 */
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';
import { restartLocalServer, freshLocalServer, serverUp, podRoot } from '../harness/lib/local.mjs';
import { getUser } from '../harness/provision.mjs';
import { snapshot, summarizeTurn, compactStep, traceLines } from './evidence.mjs';
import { StepAsks } from './asks.mjs';
import { FatalError } from './errors.mjs';

export { FatalError } from './errors.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export class ScenarioRunner {
  constructor({ scenario, steps, fixturesDir, projectId, outDir, through, freshServer = false, keepProject = false, verbose = false, reporter = {} }) {
    this.scenario = scenario;
    this.steps = steps ?? [];
    this.fixturesDir = fixturesDir;
    this.projectId = projectId;
    this.outDir = outDir;
    this.through = through ?? this.steps.length;
    this.freshServer = freshServer;
    this.keepProject = keepProject;
    this.verbose = verbose;
    this.reporter = reporter ?? {};
    this.asks = new StepAsks();
    this.traceMd = [];
  }

  log(...a) {
    if (this.verbose) console.log('[run-yaml]', ...a);
  }

  /** Play the scenario; returns { ranSteps, ofSteps, outDir, results, summary }. */
  async run() {
    const { scenario, steps, fixturesDir, projectId, outDir, through, freshServer, keepProject } = this;
    mkdirSync(outDir, { recursive: true });
    // `bootstrap: thing` — the app's project is NOT pre-created by the runner. THING starts in the
    // default `user` project and must CREATE a dedicated project itself (createProject) and build the
    // app INTO it, never into `user`. The runner discovers whatever project THING made and rebinds the
    // remaining steps into it — mirroring the real UX (create in `user`, then work in the new project),
    // which is also required for later steps to query the app's data. Tests the live-project feature.
    const bootstrapByThing = scenario.bootstrap === 'thing';
    let activeProjectId = bootstrapByThing ? 'user' : projectId;
    let createdProjectId = null;
    this.log(`scenario ${scenario.id} · project ${bootstrapByThing ? '(THING creates it)' : projectId} · steps 1..${through}/${steps.length}`);

    // The RUNNER owns its own PID file (never rely on the caller's shell `$!`): a stopper does
    // `kill $(cat <out>/runner.pid)` and it is always correct. Cleared on clean exit.
    const pidFile = join(outDir, 'runner.pid');
    writeFileSync(pidFile, String(process.pid));
    process.on('exit', () => { try { rmSync(pidFile, { force: true }); } catch { /* ignore */ } });
    // Clean stale evidence from a REUSED --out dir (a stopped-then-rerun round), so a poller can't
    // read a prior run's step files / crash log as if they were this run's.
    for (const f of readdirSyncSafe(outDir)) {
      if (/^step-\d+(\.full)?\.json$/.test(f) || f === 'summary.json' || f === 'trace.md') {
        try { rmSync(join(outDir, f), { force: true }); } catch { /* ignore */ }
      }
    }
    this.reporter.onPid?.({ pid: process.pid, pidFile });
    if (freshServer) {
      this.reporter.onFreshServerStart?.();
      await freshLocalServer();
      this.reporter.onFreshRoot?.(podRoot());
    }
    if (!(await serverUp())) throw new FatalError('local server not up — run: node harness/local-server.mjs up (or pass --fresh-server)');

    const user = await getUser(scenario.id);
    const pod = new Pod({ base: user.pod, token: user.token });
    // Correctness check: a --fresh-server pod MUST start with no USER-created projects. A clean pod
    // always has the built-in `system` and `user` projects — those are infrastructure, not state leak.
    if (freshServer) {
      const all = (await pod.listProjects().catch(() => null))?.projects ?? [];
      const builtin = new Set(['system', 'user']);
      const leaked = all.map((p) => p.id ?? p).filter((id) => !builtin.has(id));
      this.reporter.onFreshCheck?.({ all, leaked });
    }
    // Fresh project (unique id per run unless --project pins one). In `bootstrap: thing` mode the
    // runner creates NOTHING — THING must create its own project during the build.
    if (!bootstrapByThing) {
      try {
        await pod.createProject(projectId);
      } catch (e) {
        this.log(`createProject(${projectId}) — ${String(e?.message ?? e)} (continuing; may already exist)`);
      }
    }

    let thing = new ThingSession(pod, { projectId: activeProjectId, onAsk: this.asks.onAsk, verbose: this.verbose });
    await thing.start();

    const results = [];
    for (let n = 0; n < Math.min(through, steps.length); n++) {
      const step = steps[n];
      this.asks.begin(step);
      const num = n + 1;
      const rec = { step: num, verbs: Object.keys(step).filter((k) => k !== 'expect'), expect: step.expect ?? [], turns: [], asks: [], notes: [] };
      this.log(`── step ${num}: ${rec.verbs.join(', ')}`);

      try {
        if (step.fresh_session) {
          thing = new ThingSession(pod, { projectId: activeProjectId, onAsk: this.asks.onAsk, verbose: this.verbose });
          await thing.start();
          await thing.syncToTail();
          rec.notes.push('started a fresh session (zero history)');
        }
        if (step.restart_pod) {
          rec.notes.push('restarting local server…');
          await restartLocalServer();
          for (let i = 0; i < 40 && !(await serverUp()); i++) await sleep(500);
          rec.notes.push((await serverUp()) ? 'server back up' : 'server did NOT come back up');
        }

        // The message(s) for this step, with attachments if any.
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
          // The in-app chat is a project-scoped THING session with authoring caps — same project.
          const t = await thing.send(step.in_app_chat);
          rec.turns.push(summarizeTurn(t, `[in-app] ${step.in_app_chat}`));
        }
        if (step.open_app) {
          const build = await pod.appBuild(activeProjectId).catch((e) => ({ error: String(e?.message ?? e) }));
          rec.appBuild = { built: build?.built ?? build?.build?.built ?? null, routes: build?.routes ?? null, error: build?.error ?? null };
          const page = await pod.appPage(activeProjectId).catch((e) => ({ error: String(e?.message ?? e) }));
          rec.appPageStatus = page?.status ?? (page?.error ? `error: ${page.error}` : 'ok');
          rec.notes.push('opened app (built + fetched root page; browser render is the judge\'s job)');
        }
      } catch (e) {
        rec.error = String(e?.stack ?? e?.message ?? e);
        rec.notes.push(`STEP THREW: ${rec.error.split('\n')[0]}`);
      }

      // bootstrap:thing — after THING has had a turn, discover the project it created and rebind the
      // remaining steps into it. A brand-new project appearing (never `user`/`system`) IS the feature
      // working; the app + data live there, so open_app/snapshot/in_app_chat below must target it.
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
      rec.state = await snapshot(pod, activeProjectId);
      results.push(rec);
      const stem = join(outDir, `step-${String(num).padStart(2, '0')}`);
      // The judge reads step-NN.json every poll, often across several reruns — a full dump (every DB
      // row + every yield's args, ~80KB on a heavy build step) exhausts its context ("Prompt is too
      // long"). Write the COMPACT observables the judge actually scores to step-NN.json, and spill the
      // raw turn/state dump to step-NN.full.json for the rare deep-dive.
      writeFileSync(`${stem}.full.json`, JSON.stringify(rec, null, 2));
      writeFileSync(`${stem}.json`, JSON.stringify(compactStep(rec), null, 2));
      this.traceMd.push(...traceLines(rec));
    }

    // Summary.
    const summary = {
      scenario: scenario.id,
      project: activeProjectId,
      ...(bootstrapByThing ? { bootstrap: 'thing', createdProject: createdProjectId } : {}),
      ranSteps: results.length,
      ofSteps: steps.length,
      sessionStats: thing.stats?.() ?? null,
      outDir,
      finishedAt: new Date().toISOString(),
    };
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    const tracePath = join(outDir, 'trace.md');
    writeFileSync(tracePath, this.traceMd.join('\n'));
    if (!keepProject) this.log(`project ${activeProjectId} left in place (delete with: pod.deleteProject)`);
    this.reporter.onDone?.({ ranSteps: results.length, ofSteps: steps.length, outDir, tracePath });
    return { ranSteps: results.length, ofSteps: steps.length, outDir, results, summary };
  }
}

/** Convenience: `new ScenarioRunner(cfg).run()`. */
export function runScenario(cfg) {
  return new ScenarioRunner(cfg).run();
}

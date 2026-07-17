#!/usr/bin/env node
/**
 * run-scenario.mjs — the GENERIC scenario runner (thin CLI over `@lmthing/scenario-harness`).
 *
 * Plays a declarative `scenario.yaml` (persona · promise · invariants · steps) against a PER-RUN
 * LOCAL `lmthing serve`, driving the pod through the harness exactly as the /chat SPA would, and
 * writes per-step EVIDENCE (the execution trace + the real spaces/DB/app state after each step) for
 * the JUDGE to read. It does NOT judge.
 *
 * Every run is CLEAN and UNIQUELY NUMBERED: it lands in `<scenario>/runs/<n>/` with its OWN data dir
 * (`runs/<n>/data/.lmthing`), its OWN server on an allocated port, and a per-step SNAPSHOT under
 * `runs/<n>/snapshots/`. A rerun can seed from a snapshot and continue instead of replaying:
 *
 *   node scenarios/run-scenario.mjs 06-tanzania                       # a fresh run (runs/<next>)
 *   node scenarios/run-scenario.mjs 06-tanzania --through 5           # play steps 1..5
 *   node scenarios/run-scenario.mjs 06-tanzania --resume 1            # new run, seed from run 1's last step, continue
 *   node scenarios/run-scenario.mjs 06-tanzania --resume 1 --from 2   # seed from run 1's step-2, continue at step 3
 *   node scenarios/run-scenario.mjs 06-tanzania --out <dir>           # override the evidence dir (default = run dir)
 *
 * The server runs the CLI from TS source via `pnpm lmthing` (tsx) — NO `pnpm build` needed — and is
 * killed WITH this process on every exit path, including when run-scenario is signalled.
 *
 * Step verbs (see scenario-spec.md): attach[] · say · then_say · open_app · in_app_chat ·
 * fresh_session · restart_pod · if_asked{} · expect[] (expect is passed through, never executed).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local by design. This MUST be set before the harness is imported: `local.mjs` computes its `LOCAL`
// flag at module-eval time, and static `import`s are hoisted above any assignment here — so the
// harness is loaded via dynamic `import()` BELOW, after this default is in place. (Setting
// SCENARIO_TARGET=local in the environment also works and takes precedence.)
process.env.SCENARIO_TARGET ??= 'local';
const { loadScenario, planLines } = await import('./lib/scenario.mjs');
const { runScenario, FatalError } = await import('./lib/runner.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const idOrPath = argv.find((a) => !a.startsWith('--')) ?? '06-tanzania';
const verbose = argv.includes('--verbose');
const keepProject = argv.includes('--keep-project');
const keepServer = argv.includes('--keep-server'); // leave the run's server up (on normal completion) for poking
const purge = argv.includes('--purge'); // delete the whole run dir at the end
const planOnly = argv.includes('--plan'); // parse + print the plan, never connect to a pod

function fail(msg) {
  console.error(`run-scenario: ${msg}`);
  process.exit(1);
}

// Resolve scenario dir + yaml (path resolution is tied to THIS file's dir, not cwd).
let loaded;
try {
  loaded = loadScenario(idOrPath, { here: HERE });
} catch (e) {
  fail(e instanceof FatalError ? e.message : String(e?.stack ?? e));
}
const { scenario, steps, scenarioDir, fixturesDir } = loaded;

const through = Number(flag('--through', String(steps.length)));
const outDir = flag('--out') ? resolve(flag('--out')) : undefined; // default: the run dir (runner decides)
// Each run gets its own isolated data dir, so the project id is stable (no collision to avoid).
const projectId = flag('--project', scenario.project ?? scenario.id);
const runId = flag('--run') ? Number(flag('--run')) : undefined; // default: next integer in <scenario>/runs
const resumeId = flag('--resume');
const resumeFrom = resumeId ? { runId: Number(resumeId), from: flag('--from') ? Number(flag('--from')) : undefined } : null;

// ── dry plan: parse + print the step plan, never touch a pod ───────────────────────────────────
if (planOnly) {
  planLines({ scenario, steps, fixturesDir }).forEach((l) => console.log(l));
  process.exit(0);
}

// ── the exact stdout markers the judge greps (the engine computes; the shim formats) ────────────
const reporter = {
  onRunStart: ({ runId, runDir, port, base, seedFrom }) =>
    console.log(
      seedFrom
        ? `[run-scenario] run ${runId} → ${runDir} (port ${port}); seeded from ${seedFrom}`
        : `[run-scenario] run ${runId} → ${runDir} (port ${port}, ${base})`,
    ),
  onPid: ({ pid, pidFile }) => console.log(`[run-scenario] pid ${pid} → ${pidFile}`),
  onSnapshot: ({ step, dir }) => console.log(`[run-scenario] step ${step} snapshot → ${dir}`),
  onDone: ({ ranSteps, ofSteps, outDir: od, tracePath }) => {
    console.log(`\n✅ played ${ranSteps}/${ofSteps} steps → ${od}`);
    console.log(`   read: ${tracePath}  +  step-NN.json (compact; step-NN.full.json for drill-down)  +  summary.json`);
  },
};

runScenario({ scenario, steps, scenarioDir, fixturesDir, projectId, runId, resumeFrom, outDir, through, keepServer, keepProject, purge, verbose, reporter })
  .catch((e) => fail(e instanceof FatalError ? e.message : String(e?.stack ?? e)));

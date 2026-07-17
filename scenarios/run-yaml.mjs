#!/usr/bin/env node
/**
 * run-yaml.mjs — the GENERIC scenario runner (thin CLI over `@lmthing/scenario-harness`).
 *
 * Plays a declarative `scenario.yaml` (persona · promise · invariants · steps) against a LOCAL
 * `lmthing serve`, driving the pod through the harness exactly as the /chat SPA would, and writes
 * per-step EVIDENCE (the execution trace + the real spaces/DB/app state after each step) for the
 * JUDGE to read. It does NOT judge — the judge (see automation/instances/scenario-campaign/judge.md)
 * reads this output, decides pass/fail per step, and fixes at the right rung.
 *
 * The engine lives in ./lib/{scenario,runner,evidence,asks}.mjs; this file is just argument parsing,
 * config derivation, and the exact stdout markers the judge greps. Kept a raw-`node` `.mjs` with only
 * static relative imports so it runs by ABSOLUTE PATH from any cwd with no build step.
 *
 * Local only: SCENARIO_TARGET defaults to 'local' here (getUser → http://localhost:8080, no auth).
 *
 *   node scenarios/run-yaml.mjs 06-tanzania                 # play the whole scenario, fresh project
 *   node scenarios/run-yaml.mjs 06-tanzania --through 5     # play steps 1..5 (the judge's verify rerun)
 *   node scenarios/run-yaml.mjs 06-tanzania --out <dir>     # where to write evidence (default <sc>/.run)
 *
 * Step verbs (see scenario-spec.md): attach[] · say · then_say · open_app · in_app_chat ·
 * fresh_session · restart_pod · if_asked{} · expect[] (expect is passed through, never executed).
 */
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, planLines } from './lib/scenario.mjs';
import { runScenario, FatalError } from './lib/runner.mjs';

process.env.SCENARIO_TARGET ??= 'local'; // this runner is local-only by design

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
const planOnly = argv.includes('--plan'); // parse + print the plan, never connect to a pod
const freshServer = argv.includes('--fresh-server'); // WIPE the pod data dir (0 projects) + start clean first

function fail(msg) {
  console.error(`run-yaml: ${msg}`);
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
const outDir = resolve(flag('--out', join(scenarioDir, '.run')));
// A fresh server means an empty runtime root, so the stable scenario project id is collision-free
// and keeps evidence readable. Without --fresh-server (dev re-runs on a dirty root) a unique suffix
// avoids clobbering an existing project.
const projectId = flag('--project', freshServer ? (scenario.project ?? scenario.id) : `${scenario.project ?? scenario.id}-${Date.now().toString(36)}`);

// ── dry plan: parse + print the step plan, never touch a pod ───────────────────────────────────
if (planOnly) {
  planLines({ scenario, steps, fixturesDir }).forEach((l) => console.log(l));
  process.exit(0);
}

// ── the exact stdout markers the judge greps (the engine computes; the shim formats) ────────────
const reporter = {
  onPid: ({ pid, pidFile }) => console.log(`[run-yaml] pid ${pid} → ${pidFile}`),
  onFreshServerStart: () => console.log('[run-yaml] --fresh-server: wiping the pod runtime root (0 projects) and starting clean…'),
  onFreshRoot: (root) => console.log(`[run-yaml] fresh pod root: ${root}`),
  onFreshCheck: ({ all, leaked }) =>
    console.log(
      leaked.length === 0
        ? `[run-yaml] confirmed: fresh pod has no user projects (built-ins only: ${all.map((p) => p.id ?? p).join(', ')})`
        : `[run-yaml] WARNING: fresh pod already has leaked project(s): ${leaked.join(', ')} — expected none`,
    ),
  onDone: ({ ranSteps, ofSteps, outDir: od, tracePath }) => {
    console.log(`\n✅ played ${ranSteps}/${ofSteps} steps → ${od}`);
    console.log(`   read: ${tracePath}  +  step-NN.json (compact; step-NN.full.json for drill-down)  +  summary.json`);
  },
};

runScenario({ scenario, steps, fixturesDir, projectId, outDir, through, freshServer, keepProject, verbose, reporter })
  .catch((e) => fail(e instanceof FatalError ? e.message : String(e?.stack ?? e)));

#!/usr/bin/env node
/**
 * run-repro.mjs — run a TARGETED regression probe (a "repro") distilled from a scenario failure.
 *
 * A repro reproduces ONE found bug FAST: it seeds real state from a captured snapshot, boots a pod,
 * starts a FRESH THING session (NO history — sidestepping the broken resume), fires 1–3 trigger
 * messages, and evaluates a MECHANICAL `assert:` block (see lib/assert.mjs). It repeats N times and
 * reports the reproduction RATE — the fix's oracle:
 *
 *   • buggy code  → some/all runs RED (an assert fails ⇒ the bug is present)   rate > 0
 *   • fixed code  → every run GREEN (all asserts pass)                          rate = 0
 *
 * A repro is only VALID once it is proven RED on the commit where the bug was observed.
 *
 *   node scenarios/run-repro.mjs raw-dump-in-app            # runs repros/raw-dump-in-app/repro.yaml
 *   node scenarios/run-repro.mjs raw-dump-in-app --runs 10  # override the repeat count
 *   node scenarios/run-repro.mjs path/to/repro.yaml --keep  # keep each run dir for drill-down
 *
 * `repro.yaml`:
 *   id: <kebab>              from: <scenario#step>    bug: <one line>
 *   seed: ./seed             # snapshot-shaped dir (.lmthing/<project>/…); default ./seed
 *   seedProject: <id>        # optional; auto-detected from the seed otherwise
 *   runs: <n>                # repeat count (default 5)
 *   persona: <str>           knows: [<str>]   if_asked handled per step (as in a scenario)
 *   steps: [ {say|in_app_chat|attach|…}, … ]     # the trigger(s); a FRESH session plays them
 *   assert: [ "<mechanical assert>", … ]         # ALL must pass for a run to be GREEN
 */
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';

process.env.SCENARIO_TARGET ??= 'local'; // local by design; must precede the harness import (hoisting)
const { parseYaml } = await import('./lib/yaml.mjs');
const { runScenario, FatalError } = await import('./lib/runner.mjs');
const { evaluateAll } = await import('./lib/assert.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const idOrPath = argv.find((a) => !a.startsWith('--')) ?? 'raw-dump-in-app';
const keep = argv.includes('--keep');
const verbose = argv.includes('--verbose');

function fail(msg) { console.error(`run-repro: ${msg}`); process.exit(1); }

// ── resolve the repro dir + yaml ──────────────────────────────────────────────────────────────
const reproDir = idOrPath.endsWith('.yaml') ? dirname(resolve(idOrPath)) : resolve(HERE, 'repros', idOrPath);
const yamlPath = idOrPath.endsWith('.yaml') ? resolve(idOrPath) : join(reproDir, 'repro.yaml');
if (!existsSync(yamlPath)) fail(`no repro.yaml at ${yamlPath}`);
const repro = parseYaml(readFileSync(yamlPath, 'utf8'));
if (!repro.steps?.length) fail('repro has no steps');
if (!repro.assert?.length) fail('repro has no assert block — a repro without a mechanical oracle cannot go red/green');

// ── the seed + its project ──────────────────────────────────────────────────────────────────────
// The seed payload lives either under `seed/.lmthing/` (a raw snapshot) or directly in `seed/` (a
// committed BARE seed, de-wrapped so it escapes the `.lmthing/` gitignore). seedRun() handles both.
const seedDir = resolve(reproDir, repro.seed ?? './seed');
const lmRoot = existsSync(join(seedDir, '.lmthing')) ? join(seedDir, '.lmthing') : seedDir;
if (!existsSync(lmRoot)) fail(`no seed at ${seedDir}`);
function detectSeedProject(lm) {
  for (const e of readdirSync(lm)) {
    if (e === 'system' || e === 'store-apps') continue;
    let st; try { st = statSync(join(lm, e)); } catch { continue; }
    if (st.isDirectory() && (existsSync(join(lm, e, 'project.json')) || existsSync(join(lm, e, 'database')) || existsSync(join(lm, e, 'spaces')))) return e;
  }
  return null;
}
const seedProject = repro.seedProject ?? detectSeedProject(lmRoot);
if (!seedProject) fail(`could not detect the seed project under ${lmRoot} — set seedProject: in repro.yaml`);

// ── the synthetic scenario the runner plays (bootstrap NOT 'thing' — the project is seeded) ───────
const scenario = {
  id: repro.id ?? basename(reproDir),
  title: repro.bug ?? repro.id ?? 'repro',
  project: seedProject,
  persona: repro.persona ?? '(repro — targeted regression probe)',
  invariants: [],
  knows: repro.knows ?? [],
  steps: repro.steps,
};
const runs = Number(flag('--runs', String(repro.runs ?? 5)));
const quiet = { onRunStart() {}, onPid() {}, onSnapshot() {}, onDone() {} };

console.log(`repro ${scenario.id} — ${scenario.title}`);
console.log(`  from: ${repro.from ?? '(unstated)'}  ·  seed: ${seedProject}  ·  runs: ${runs}  ·  asserts: ${repro.assert.length}`);

// ── run N times, evaluate, tally ─────────────────────────────────────────────────────────────────
const passCounts = new Map(repro.assert.map((a) => [a, 0]));
let redRuns = 0;
let firstRed = null;
for (let i = 1; i <= runs; i++) {
  let res;
  try {
    res = await runScenario({
      scenario, steps: repro.steps, scenarioDir: reproDir, fixturesDir: join(reproDir, 'fixtures'),
      projectId: seedProject, seedDir, seedProject, through: repro.steps.length,
      keepServer: false, keepProject: true, purge: false, verbose, reporter: quiet,
    });
  } catch (e) {
    fail(e instanceof FatalError ? e.message : String(e?.stack ?? e));
  }
  const last = res.results[res.results.length - 1] ?? { state: {}, turns: [] };
  const ctx = { state: last.state ?? {}, turns: last.turns ?? [], dataDir: join(res.summary.runDir, 'data'), projectId: seedProject };
  const { green, results } = evaluateAll(repro.assert, ctx);
  for (const r of results) if (r.pass) passCounts.set(r.line, passCounts.get(r.line) + 1);
  const failed = results.filter((r) => !r.pass);
  if (!green) { redRuns++; if (!firstRed) firstRed = failed; }
  const stepErr = last.error ? ` ⚠️ ${String(last.error).split('\n')[0].slice(0, 80)}` : '';
  console.log(`  [run ${i}] ${green ? 'GREEN' : 'RED  '}${green ? '' : ` (${failed.length}/${repro.assert.length} failed)`}${stepErr}`);
  if (!green) for (const r of failed) console.log(`      ✗ ${r.line}  —  ${r.actual}${r.error ? ` [${r.error}]` : ''}`);
  if (!keep) { try { rmSync(res.summary.runDir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

// ── verdict ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n  asserts (green runs / total):');
for (const [a, n] of passCounts) console.log(`    ${n}/${runs}  ${a}`);
const rate = `${redRuns}/${runs}`;
console.log(`\nREPRO ${scenario.id}: ${redRuns > 0 ? 'RED' : 'GREEN'} ${rate}  (reproduction rate; RED>0 ⇒ bug present, GREEN 0/N ⇒ fixed)`);
// No process.exit(): let the event loop drain so buffered stdout flushes to a redirected file (an
// early process.exit truncates async writes). The harness has already torn down every run's server.

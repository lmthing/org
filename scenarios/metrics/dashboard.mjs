#!/usr/bin/env node
/**
 * dashboard.mjs — the ratchet-metrics CLI.
 *
 * Loads a run's (or every run's) artifacts via `lib/artifacts.mjs`, reduces its trace(s) via
 * `lib/scope.mjs`, computes every metric in `lib/metrics.mjs` against the targets declared in
 * `lib/targets.mjs`, and prints a real dashboard to stdout — plus writes a machine-readable JSON
 * report alongside, for later CI / lmauto consumption. See `README.md` in this directory for the
 * full contract and `judge-contract.md` for the `judge.json` shape the judged metrics read.
 *
 * Usage (run from anywhere — every path resolves from THIS file via `artifacts.mjs#SCENARIOS_DIR`,
 * never from `process.cwd()`):
 *
 *   node scenarios/metrics/dashboard.mjs                       every scenario, latest complete run
 *   node scenarios/metrics/dashboard.mjs <scenarioId>          one scenario, latest complete run
 *   node scenarios/metrics/dashboard.mjs <scenarioId> <runId>  one scenario, one specific run
 *   node scenarios/metrics/dashboard.mjs <scenarioId> --all    every run of that scenario (a trend)
 *
 * Flags:
 *   --json <path>   write the JSON report here instead of the default `scenarios/metrics/out/*.json`
 *   --quiet         suppress the printed table (the JSON report is still written)
 *
 * Exit code: 1 if any MEASURED metric misses its `targets.mjs` bar, 0 otherwise. A `null` metric
 * (an honest measurement gap) never fails the exit code by itself — it prints as a warning line so a
 * human or lmauto can see the gap without the run being scored as a regression for it.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCENARIOS_DIR, listRuns, loadProjectViews, loadRun, resolveRun } from './lib/artifacts.mjs';
import { mergeDigests, readTraceDigest } from './lib/scope.mjs';
import { computeMetrics } from './lib/metrics.mjs';
import { PLAN_TARGETS, meetsTarget, movement } from './lib/targets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'out');

// ──────────────────────────────────────────────────────────────────────────────
// argv
// ──────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { scenarioId: null, runId: null, all: false, json: null, quiet: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--json') opts.json = argv[++i] ?? null;
    else rest.push(a);
  }
  if (rest[0]) opts.scenarioId = rest[0];
  if (rest[1] != null) opts.runId = rest[1];
  return opts;
}

/** Every scenario directory that could hold runs — `<NN>-<name>`, matching the runner's own convention. */
export function discoverScenarios({ scenariosDir = SCENARIOS_DIR } = {}) {
  return readdirSync(scenariosDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+-/.test(e.name))
    .map((e) => e.name)
    .filter((id) => listRuns(id, { scenariosDir }).length > 0)
    .sort();
}

// ──────────────────────────────────────────────────────────────────────────────
// one run → one report
// ──────────────────────────────────────────────────────────────────────────────

/** Load + score exactly one run. Never throws for an honest measurement gap — only for a bad run id. */
export function reportForRun(scenarioId, runId) {
  const run = loadRun(scenarioId, runId);
  const digests = run.traces.map((t) => readTraceDigest(t));
  const digest = mergeDigests(digests);
  // `loadProjectViews` needs a real path to `join()` against — when the run never got far enough to
  // record a `projectId` (or the project dir vanished), point it at a path guaranteed not to exist so
  // it reports `found: false` honestly instead of throwing on a null path.
  const views = loadProjectViews(run.projectDir ?? join(run.runDir, '__no-project-dir__'));
  const { metrics, app, openApp } = computeMetrics({ run, digest, views });
  const scored = {};
  for (const [id, m] of Object.entries(metrics)) {
    scored[id] = { ...m, pass: m.value == null ? null : meetsTarget(id, m.value) };
  }
  return {
    scenarioId,
    runId: run.runId,
    runDir: run.runDir,
    live: run.live,
    generatedAt: new Date().toISOString(),
    app,
    openApp,
    traceCount: run.traces.length,
    metrics: scored,
  };
}

/** Every run of a scenario, oldest first, so `--all`'s trend reads chronologically. */
function reportsForAllRuns(scenarioId) {
  const runIds = [...listRuns(scenarioId)].reverse();
  const reports = [];
  for (const runId of runIds) {
    try {
      reports.push(reportForRun(scenarioId, runId));
    } catch (err) {
      reports.push({ scenarioId, runId, error: String(err?.message ?? err) });
    }
  }
  return reports;
}

// ──────────────────────────────────────────────────────────────────────────────
// printing
// ──────────────────────────────────────────────────────────────────────────────

function fmtValue(m) {
  if (m.value == null) return 'null';
  if (Number.isInteger(m.value)) return String(m.value);
  return m.value.toFixed(3);
}

function fmtTarget(id) {
  const t = PLAN_TARGETS[id]?.target;
  if (!t) return '—';
  return `${t.op} ${t.value}`;
}

function fmtStatus(m) {
  if (m.value == null) return `null: ${m.reason}`;
  if (m.pass == null) return '— (no target)';
  return m.pass ? 'PASS' : 'FAIL';
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? `${s.slice(0, n - 1)}…` : s + ' '.repeat(n - s.length);
}

function printReport(report) {
  const header = report.live ? ' (LIVE — run still in flight, scores are partial)' : '';
  console.log(`\n${report.scenarioId} · run ${report.runId}${header}`);
  console.log(`  app: ${report.app.state} — ${report.app.why}`);
  if (report.error) {
    console.log(`  ERROR: ${report.error}`);
    return;
  }
  console.log(pad('metric', 22) + pad('value', 10) + pad('better', 8) + pad('target', 10) + 'status');
  console.log('-'.repeat(90));
  for (const [id, m] of Object.entries(report.metrics)) {
    const line = pad(m.label ?? id, 22) + pad(fmtValue(m), 10) + pad(m.better, 8) + pad(fmtTarget(id), 10) + fmtStatus(m);
    console.log(line.length > 200 ? `${line.slice(0, 197)}…` : line);
  }
}

function printTrend(scenarioId, reports) {
  console.log(`\n${scenarioId} — trend over ${reports.length} run(s)`);
  const ids = Object.keys(PLAN_TARGETS);
  for (const id of ids) {
    const series = reports.map((r) => r.metrics?.[id]?.value ?? null);
    let line = `  ${pad(PLAN_TARGETS[id].label, 30)} `;
    for (let i = 0; i < series.length; i += 1) {
      const v = series[i];
      line += v == null ? 'null' : Number.isInteger(v) ? String(v) : v.toFixed(2);
      if (i < series.length - 1) {
        const mv = movement(id, series[i], series[i + 1]);
        const arrow = mv.direction === 'up' ? '↑' : mv.direction === 'down' ? '↓' : mv.direction === 'flat' ? '=' : '?';
        const mark = mv.good === true ? arrow : mv.good === false ? `${arrow}!` : arrow;
        line += ` ${mark} `;
      }
    }
    console.log(line);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────────────

function writeJson(defaultName, payload, jsonOverride) {
  const path = jsonOverride ?? join(OUT_DIR, defaultName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

function anyFail(report) {
  return Object.values(report.metrics ?? {}).some((m) => m.pass === false);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let exitCode = 0;

  if (!opts.scenarioId) {
    // No scenario named: every discovered scenario, its latest run.
    const ids = discoverScenarios();
    if (ids.length === 0) {
      console.log('no scenario run directories found under', SCENARIOS_DIR);
      process.exit(0);
    }
    const reports = [];
    for (const id of ids) {
      try {
        const { runId } = resolveRun(id, null);
        const report = reportForRun(id, runId);
        reports.push(report);
        if (!opts.quiet) printReport(report);
        if (anyFail(report)) exitCode = 1;
      } catch (err) {
        reports.push({ scenarioId: id, error: String(err?.message ?? err) });
        if (!opts.quiet) console.log(`\n${id}: ERROR — ${err?.message ?? err}`);
      }
    }
    const path = writeJson('all-scenarios.json', { generatedAt: new Date().toISOString(), reports }, opts.json);
    console.log(`\nJSON report: ${path}`);
    process.exit(exitCode);
  }

  if (opts.all) {
    const reports = reportsForAllRuns(opts.scenarioId);
    if (!opts.quiet) {
      for (const r of reports) printReport(r);
      printTrend(opts.scenarioId, reports.filter((r) => !r.error));
    }
    if (reports.some((r) => anyFail(r))) exitCode = 1;
    const path = writeJson(`${opts.scenarioId}-all.json`, { generatedAt: new Date().toISOString(), scenarioId: opts.scenarioId, reports }, opts.json);
    console.log(`\nJSON report: ${path}`);
    process.exit(exitCode);
  }

  // One scenario, one run (named or latest complete).
  const { runId } = resolveRun(opts.scenarioId, opts.runId);
  const report = reportForRun(opts.scenarioId, runId);
  if (!opts.quiet) printReport(report);
  if (anyFail(report)) exitCode = 1;
  const path = writeJson(`${opts.scenarioId}-${runId}.json`, report, opts.json);
  console.log(`\nJSON report: ${path}`);
  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

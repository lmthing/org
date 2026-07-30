/**
 * artifacts.mjs — locate and load everything ONE scenario run left on disk.
 *
 * This module knows the run layout and nothing about metrics. Every path here is real, checked
 * against runs on disk (`13-plant-care/runs/1`, `10-family-recipes/runs/2`), and a missing artifact
 * is reported as missing — never defaulted to an empty one, because an empty artifact reads as
 * "clean" and that is the exact inversion the ratchet exists to catch.
 *
 * A run directory (`scenarios/<id>/runs/<n>/`) holds:
 *
 *   run.json                        {runId, scenarioId, projectId, port, completedSteps, stepCount}
 *   summary.json                    written only on a NORMAL finish (absent ⇒ the run was killed)
 *   step-NN.json / step-NN.full.json  the judge's compact + raw evidence per step
 *   trace.md                        the same evidence in prose
 *   sessions.log                    raw server stdout ([stmt]/[error]/[inspect]/[authoring])
 *   runner.pid                      present while the runner lives
 *   snapshots/step-NN/              per-step seed for `--resume`
 *   data/.lmthing/                  THE POD'S OWN STATE — the richest evidence in the run:
 *     sessions-ledger.jsonl           per-session tokens/cost/delegates
 *     <projectId>/**                  the app the pipeline actually built (pages/*.view.json, api/…)
 *     <scope>/sessions/<id>/trace.json  the FULL host event stream (see scope.mjs)
 *
 * `judge.json` is NOT written by the runner — it is the judge's own verdict file, whose shape is
 * pinned in `../judge-contract.md`. Absent ⇒ every judged metric is `null` with a reason.
 *
 * Zero dependencies — Node built-ins only, same rule as the rest of `scenarios/`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `sdk/org/scenarios` — resolved from THIS file, never from cwd (the runner's own convention). */
export const SCENARIOS_DIR = resolve(HERE, '../..');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Run ids for a scenario, NEWEST FIRST. `latest` and other non-numeric entries are skipped. */
export function listRuns(scenarioId, { scenariosDir = SCENARIOS_DIR } = {}) {
  const runsDir = join(scenariosDir, scenarioId, 'runs');
  if (!isDir(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
    .filter((n) => isDir(join(runsDir, String(n))))
    .sort((a, b) => b - a);
}

/**
 * Resolve `{scenarioId, runId}` to a run dir. With no `runId` it takes the newest COMPLETE run —
 * one whose `run.json` exists and whose runner is no longer holding a pidfile — falling back to the
 * newest run of any kind, flagged `live: true`, so a caller can refuse to score a run still in
 * flight rather than scoring half of it.
 */
export function resolveRun(scenarioId, runId, { scenariosDir = SCENARIOS_DIR } = {}) {
  const runs = listRuns(scenarioId, { scenariosDir });
  if (runs.length === 0) throw new Error(`no runs on disk for scenario "${scenarioId}" (looked in ${join(scenariosDir, scenarioId, 'runs')})`);
  const pick = runId != null ? Number(runId) : runs.find((n) => !existsSync(join(scenariosDir, scenarioId, 'runs', String(n), 'runner.pid'))) ?? runs[0];
  const runDir = join(scenariosDir, scenarioId, 'runs', String(pick));
  if (!isDir(runDir)) throw new Error(`no run ${pick} for scenario "${scenarioId}" (expected ${runDir})`);
  return { scenarioId, runId: pick, runDir, live: existsSync(join(runDir, 'runner.pid')) };
}

/** Every `<scope>/sessions/<id>/` directory under a run's pod data dir, with its trace path. */
export function findSessionTraces(dataRoot) {
  const out = [];
  if (!isDir(dataRoot)) return out;
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const child = join(dir, e.name);
      if (e.name === 'sessions') {
        for (const s of readdirSync(child, { withFileTypes: true })) {
          if (!s.isDirectory()) continue;
          const trace = join(child, s.name, 'trace.json');
          if (existsSync(trace)) {
            out.push({
              sessionId: s.name,
              // The scope a session belongs to — `<projectId>`, `user`, or
              // `<projectId>/spaces/<space>` for a `space_session` run.
              scope: dir.slice(dataRoot.length + 1).replace(/\\/g, '/'),
              tracePath: trace,
              metaPath: existsSync(join(child, s.name, 'meta.json')) ? join(child, s.name, 'meta.json') : null,
              bytes: statSync(trace).size,
            });
          }
        }
        continue;
      }
      walk(child, depth + 1);
    }
  };
  walk(dataRoot, 0);
  return out.sort((a, b) => a.scope.localeCompare(b.scope) || a.sessionId.localeCompare(b.sessionId));
}

/** Read every `pages/**` view artifact of a built project. Ground truth for the layout metrics. */
export function loadProjectViews(projectDir) {
  const pagesDir = join(projectDir, 'pages');
  const result = { projectDir, pagesDir, found: isDir(pagesDir), pages: [], components: [], shell: null, malformed: [] };
  if (!result.found) return result;
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, e.name);
      if (e.isDirectory()) {
        walk(child, prefix ? `${prefix}/${e.name}` : e.name);
        continue;
      }
      if (!e.name.endsWith('.view.json')) continue;
      const base = e.name.replace(/\.view\.json$/, '');
      const rel = prefix ? `${prefix}/${base}` : base;
      const spec = readJson(child);
      if (spec == null) {
        result.malformed.push({ file: child, rel });
        continue;
      }
      // `pages/_shell.view.json` is the app shell, not a route; `pages/components/*` are component
      // definitions. Both live under `pages/` and neither is a page — the same rule 18-finalize uses.
      if (rel === '_shell') result.shell = { file: child, spec };
      else if (prefix === 'components' || prefix.startsWith('components/')) result.components.push({ name: base, rel, file: child, spec });
      else result.pages.push({ route: rel, file: child, spec });
    }
  };
  walk(pagesDir, '');
  result.pages.sort((a, b) => a.route.localeCompare(b.route));
  result.components.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/**
 * Load one run's artifacts. Traces are located but NOT parsed here — `trace.json` is routinely
 * 10–20 MB and the caller decides which sessions it needs (see `scope.mjs#digestTrace`).
 */
export function loadRun(scenarioId, runId, { scenariosDir = SCENARIOS_DIR } = {}) {
  const { runDir, live } = resolveRun(scenarioId, runId, { scenariosDir });
  const runJson = readJson(join(runDir, 'run.json'));
  const summary = readJson(join(runDir, 'summary.json'));
  const projectId = runJson?.projectId ?? null;
  const dataRoot = join(runDir, 'data', '.lmthing');
  const projectDir = projectId ? join(dataRoot, projectId) : null;

  const steps = readdirSync(runDir)
    .filter((n) => /^step-\d+\.json$/.test(n))
    .map((n) => Number(n.slice(5, -5)))
    .sort((a, b) => a - b)
    .map((n) => {
      const pad = String(n).padStart(2, '0');
      return { step: n, compact: readJson(join(runDir, `step-${pad}.json`)), fullPath: join(runDir, `step-${pad}.full.json`) };
    });

  return {
    scenarioId,
    runId: runJson?.runId ?? Number(runId ?? 0),
    runDir,
    live,
    runJson,
    summary,
    projectId,
    dataRoot: isDir(dataRoot) ? dataRoot : null,
    projectDir: projectDir && isDir(projectDir) ? projectDir : null,
    steps,
    traces: findSessionTraces(dataRoot),
    sessionsLedger: readLedger(join(dataRoot, 'sessions-ledger.jsonl')),
    sessionsLogPath: existsSync(join(runDir, 'sessions.log')) ? join(runDir, 'sessions.log') : null,
    // The judge's verdict file — see ../judge-contract.md. Absent is the NORMAL state before a judge
    // has scored the run, and it is why the judged metrics come back null instead of zero.
    judge: readJson(join(runDir, 'judge.json')),
    judgePath: join(runDir, 'judge.json'),
  };
}

/** `sessions-ledger.jsonl` — one JSON object per line, last line per sessionId wins. */
export function readLedger(path) {
  if (!existsSync(path)) return null;
  const byId = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t);
      if (rec?.sessionId) byId.set(rec.sessionId, rec);
    } catch {
      /* a torn last line while the pod was writing — skip it, never fail the extraction */
    }
  }
  return [...byId.values()];
}

export { readJson };

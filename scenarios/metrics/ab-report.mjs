#!/usr/bin/env node
/**
 * ab-report.mjs — score two runs of the SAME brief against each other.
 *
 * The ratchet dashboard (`dashboard.mjs`) answers "is the viewbuilder getting better?". This answers
 * a different question, the one that gates a migration: **given the same brief, is the app the
 * viewbuilder produced as good as the one the appbuilder produced, and does it actually work?**
 *
 * So every measurement here is deliberately BUILDER-NEUTRAL — computed from artifacts both builders
 * leave behind, never from a spec-only concept. `dashboard.mjs`'s layout-override and vocabulary-gap
 * metrics are meaningless for a TSX app and are not reproduced; what is reproduced is everything a
 * user would notice.
 *
 * Three questions, in the order that matters:
 *
 *   1. DOES IT WORK — build, typecheck, and then the things only a browser can answer: is anything
 *      painted, is the scroller a real height, are the controls reachable, are the forms fillable,
 *      and does clicking one DO something. `buildApp` + `appCheck` + HTTP 200 were all green on an
 *      app that rendered blank on every route, so the first three lines are necessary and not
 *      sufficient, and this report puts them next to the ones that are.
 *   2. IS IT AS CAPABLE — tables, seeded rows, endpoints, routes. An app that "works" because it
 *      built three empty pages is not the comparison anyone wants.
 *   3. WHAT DID IT COST — authored UI lines, tokens, wall clock.
 *
 * A missing measurement prints as `null: <reason>`, never as 0 — a zero reads as clean, and that
 * inversion is how a fully-broken page once scored 100%.
 *
 *   node scenarios/metrics/ab-report.mjs 30-bike-workshop 101 201
 *   node scenarios/metrics/ab-report.mjs 30-bike-workshop 101 201 --json out.json
 */
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRun, loadProjectViews } from './lib/artifacts.mjs';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** Every file under `dir` matching `test`, as `{rel, lines, head}`. */
function walkFiles(dir, test, prefix = '') {
  if (!isDir(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(abs, test, rel));
    else if (test(e.name)) {
      const text = readFileSync(abs, 'utf8');
      out.push({ rel, abs, lines: text.split('\n').length, head: text.slice(0, 300) });
    }
  }
  return out;
}

/**
 * What the MODEL actually authored for the UI, which is not the same as what is on disk.
 *
 * A spec app's `pages/*.tsx` are host-generated wrappers carrying an `AUTO-GENERATED` banner — the
 * model never wrote a line of them, so counting them as authored UI would flatter the viewbuilder's
 * competitor and understate its own reduction. They are identified by the banner, not by guessing
 * from the extension.
 */
export function authoredUi(projectDir) {
  if (!projectDir) return { tsx: null, specs: null, generatedWrappers: null, reason: 'the run left no project directory' };
  const pages = join(projectDir, 'pages');
  const tsxFiles = walkFiles(pages, (n) => n.endsWith('.tsx'));
  const generated = tsxFiles.filter((f) => /AUTO-GENERATED/i.test(f.head));
  const handTsx = tsxFiles.filter((f) => !/AUTO-GENERATED/i.test(f.head));
  const comps = walkFiles(join(projectDir, 'components'), (n) => n.endsWith('.tsx'));
  const specs = walkFiles(pages, (n) => n.endsWith('.view.json'));
  return {
    tsx: handTsx.reduce((n, f) => n + f.lines, 0) + comps.reduce((n, f) => n + f.lines, 0),
    tsxFiles: handTsx.length + comps.length,
    specs: specs.reduce((n, f) => n + f.lines, 0),
    specFiles: specs.length,
    generatedWrappers: generated.length,
    api: walkFiles(join(projectDir, 'api'), (n) => n.endsWith('.ts')).reduce((n, f) => n + f.lines, 0),
  };
}

/** Endpoints = `api/<path>/<METHOD>.ts`; routes = whatever the build actually served. */
export function capability(run) {
  const dir = run.projectDir;
  const db = dir ? walkFiles(join(dir, 'database'), (n) => n.endsWith('.json')) : [];
  const api = dir ? walkFiles(join(dir, 'api'), (n) => /^(GET|POST|PUT|PATCH|DELETE)\.ts$/.test(n)) : [];
  const views = dir ? loadProjectViews(dir) : null;
  const last = lastOpenApp(run);
  const rows = {};
  for (const s of run.steps) for (const [t, n] of Object.entries(s.compact?.state?.appTables ?? {})) rows[t] = n;
  return {
    tables: db.length || null,
    rows: Object.values(rows).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0),
    rowsByTable: rows,
    endpoints: api.length || null,
    routes: last?.appBuild?.routes?.length ?? null,
    specPages: views ? views.pages.length : null,
    hooks: dir ? walkFiles(join(dir, 'hooks'), (n) => n.endsWith('.ts')).length : null,
    events: dir ? walkFiles(join(dir, 'events'), (n) => n.endsWith('.ts')).length : null,
  };
}

/** The LAST step that opened the app — the app's final state is what the user would get. */
export function lastOpenApp(run) {
  let found = null;
  for (const s of run.steps) if (s.compact?.appBuild) found = s.compact;
  return found;
}

/** Question 1: does it work? Build/typecheck first, then the things only a browser can see. */
export function worksVerdict(run) {
  const s = lastOpenApp(run);
  if (!s) return { measured: false, reason: 'no step in this run ever opened the app' };
  const g = s.renderGate;
  const base = {
    built: s.appBuild?.built ?? null,
    typechecks: s.appCheck?.ok ?? null,
    typeErrors: s.appCheck?.errorCount ?? null,
    rootStatus: s.appPageStatus ?? null,
  };
  if (!g) return { ...base, browser: { measured: false, reason: 'this step did not run the render gate (open_app: true, not {render:true})' } };
  if (g.unavailable || !g.counts) return { ...base, browser: { measured: false, reason: g.reason ?? 'the render gate reported no counts' } };
  const c = g.counts;
  return {
    ...base,
    browser: {
      measured: true,
      ok: g.ok,
      routesMeasured: `${c.measured}/${c.pages}`,
      blankPages: c.blank,
      collapsedScrollers: c.collapsedScrollers,
      unreachableControls: c.unusableInteractive,
      emptyForms: c.emptyForms,
      horizontalOverflow: c.horizontalOverflow,
      // The click. `clicked` is the denominator: 0 dead out of 0 clicked is not a working app.
      clicked: c.clicked,
      acted: c.actedOnClick,
      deadControls: c.clicked ? c.deadControls : null,
      deadControlsReason: c.clicked ? undefined : 'no control was clicked on any route — nothing was proven about whether the app responds',
      consoleErrors: c.consoleErrors,
      findings: (g.findings ?? []).map((f) => `${f.code} ${f.route}@${f.viewport}`),
      screenshots: g.screenshots ?? [],
    },
  };
}

/** Question 3: what did it cost? */
export function cost(run) {
  const ledger = run.sessionsLedger;
  // The ledger records input and output separately (`totalInputTokens`/`totalOutputTokens`), one
  // line per session with the LAST line per sessionId winning — `readLedger` has already collapsed
  // that, so these just add up.
  let tokens = null;
  let tokensIn = null;
  let tokensOut = null;
  if (ledger && ledger.length) {
    tokensIn = ledger.reduce((n, e) => n + (e.totalInputTokens ?? 0), 0);
    tokensOut = ledger.reduce((n, e) => n + (e.totalOutputTokens ?? 0), 0);
    tokens = tokensIn + tokensOut || null;
  }
  const durations = run.steps.map((s) => (s.compact?.turns ?? []).reduce((n, t) => n + (t.durationMs ?? 0), 0));
  const wall = durations.reduce((a, b) => a + b, 0);
  return {
    tokens: tokens ?? null,
    tokensIn,
    tokensOut,
    tokensReason: tokens ? undefined : 'the sessions ledger recorded no token totals',
    sessions: ledger?.length ?? null,
    turnMs: wall || null,
    steps: `${run.runJson?.completedSteps ?? run.steps.length}/${run.runJson?.stepCount ?? '?'}`,
    finished: !!run.summary,
    finishedReason: run.summary ? undefined : 'no summary.json — the run was killed or is still going',
  };
}

export function reportFor(scenarioDir, runId, label) {
  const run = loadRun(scenarioDir, runId);
  return { label, runId: run.runId, scenarioId: run.runJson?.scenarioId ?? null, runDir: run.runDir, works: worksVerdict(run), capability: capability(run), authored: authoredUi(run.projectDir), cost: cost(run) };
}

const F = (v) => (v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'yes' : 'NO') : String(v));

function printTable(a, b) {
  const rows = [
    ['', a.label, b.label],
    ['— DOES IT WORK —', '', ''],
    ['builds', F(a.works.built), F(b.works.built)],
    ['typechecks', F(a.works.typechecks), F(b.works.typechecks)],
    ['type errors', F(a.works.typeErrors), F(b.works.typeErrors)],
    ['root page', F(a.works.rootStatus), F(b.works.rootStatus)],
    ['routes measured in browser', F(a.works.browser?.routesMeasured), F(b.works.browser?.routesMeasured)],
    ['BLANK pages', F(a.works.browser?.blankPages), F(b.works.browser?.blankPages)],
    ['collapsed scrollers', F(a.works.browser?.collapsedScrollers), F(b.works.browser?.collapsedScrollers)],
    ['unreachable controls', F(a.works.browser?.unreachableControls), F(b.works.browser?.unreachableControls)],
    ['empty forms', F(a.works.browser?.emptyForms), F(b.works.browser?.emptyForms)],
    ['h-overflow (phone)', F(a.works.browser?.horizontalOverflow), F(b.works.browser?.horizontalOverflow)],
    ['clicked / acted', `${F(a.works.browser?.clicked)} / ${F(a.works.browser?.acted)}`, `${F(b.works.browser?.clicked)} / ${F(b.works.browser?.acted)}`],
    ['DEAD controls', F(a.works.browser?.deadControls), F(b.works.browser?.deadControls)],
    ['console errors', F(a.works.browser?.consoleErrors), F(b.works.browser?.consoleErrors)],
    ['— IS IT AS CAPABLE —', '', ''],
    ['tables', F(a.capability.tables), F(b.capability.tables)],
    ['seeded rows', F(a.capability.rows), F(b.capability.rows)],
    ['endpoints', F(a.capability.endpoints), F(b.capability.endpoints)],
    ['routes served', F(a.capability.routes), F(b.capability.routes)],
    ['hooks / events', `${F(a.capability.hooks)} / ${F(a.capability.events)}`, `${F(b.capability.hooks)} / ${F(b.capability.events)}`],
    ['— WHAT DID IT COST —', '', ''],
    ['authored UI (TSX lines)', F(a.authored.tsx), F(b.authored.tsx)],
    ['authored UI (spec lines)', F(a.authored.specs), F(b.authored.specs)],
    ['generated wrappers', F(a.authored.generatedWrappers), F(b.authored.generatedWrappers)],
    ['api lines', F(a.authored.api), F(b.authored.api)],
    ['tokens (in+out)', F(a.cost.tokens), F(b.cost.tokens)],
    ['sessions', F(a.cost.sessions), F(b.cost.sessions)],
    ['turn time (s)', F(a.cost.turnMs && Math.round(a.cost.turnMs / 1000)), F(b.cost.turnMs && Math.round(b.cost.turnMs / 1000))],
    ['steps completed', F(a.cost.steps), F(b.cost.steps)],
  ];
  const w = [Math.max(...rows.map((r) => r[0].length)), Math.max(...rows.map((r) => r[1].length), 12), Math.max(...rows.map((r) => r[2].length), 12)];
  for (const r of rows) console.log(`${r[0].padEnd(w[0])}  ${r[1].padStart(w[1])}  ${r[2].padStart(w[2])}`);
  for (const side of [a, b]) {
    const f = side.works.browser?.findings ?? [];
    const why = side.works.browser?.measured === false ? `  (browser: null — ${side.works.browser.reason})` : '';
    console.log(`\n${side.label} findings (${f.length})${why}`);
    for (const x of f) console.log(`  · ${x}`);
    const shots = side.works.browser?.screenshots ?? [];
    if (shots.length) console.log(`  screenshots: ${shots[0].replace(/[^/]+$/, '')} (${shots.length})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const jsonAt = argv.indexOf('--json');
  const out = jsonAt >= 0 ? argv.splice(jsonAt, 2)[1] : null;
  const [dir, appRun, viewRun] = argv;
  if (!dir || !appRun || !viewRun) {
    console.error('usage: node scenarios/metrics/ab-report.mjs <scenario-dir> <appbuilderRunId> <viewbuilderRunId> [--json <path>]');
    process.exit(2);
  }
  const a = reportFor(dir, appRun, 'appbuilder');
  const b = reportFor(dir, viewRun, 'viewbuilder');
  console.log(`\nA/B — ${dir}   appbuilder run ${a.runId}  vs  viewbuilder run ${b.runId}\n`);
  printTable(a, b);
  if (out) {
    writeFileSync(out, JSON.stringify({ scenario: dir, appbuilder: a, viewbuilder: b }, null, 2));
    console.log(`\n→ ${out}`);
  }
}

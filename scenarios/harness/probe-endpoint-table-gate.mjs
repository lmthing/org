#!/usr/bin/env node
/**
 * Endpoint→table completeness gate + incremental-scope probe.
 *
 * Repro class (06-tanzania run 25 step 10): a grow request ("start recording X") against an
 * existing app shipped a full CRUD endpoint set whose backing table was NEVER created — the
 * planned name was rejected at write time (not snake_case), the implement fork resolved ok:false
 * without retrying, the endpoint forks wrote against the missing table anyway ("the app build
 * gate catches any residual table schema issues"), and the gate could NOT catch it: the db
 * surface is dynamically typed, so buildApp() passes clean and every call 500s at runtime. The
 * same pass also remodeled 4 unrelated tables nobody asked for.
 *
 * The fix under test (build_live_project): a mechanical endpoint→table scan in the compile
 * passes + finalize (a missing referenced table fails the gate like an unresolved import), a
 * retry branch in implement_tables that resolves the ACTUALLY-written name, and an
 * incremental-scope rule in plan_app (the request bounds membership).
 *
 * This probe drives the exact class end-to-end, twice through the automator directly:
 *   1. FIRST BUILD — a small two-table app with seeded rows and a home page.
 *   2. GROW — one NEW record kind requested by name.
 * Then asserts MECHANICALLY:
 *   A. every api module's literal db.<verb>('t') ref resolves to a database/*.json table
 *   B. the grow shipped a backing table for the new record kind (≥1 new table)
 *   C. a GET endpoint referencing a new table answers on the app's own API origin (no 5xx)
 *   D. scope: every pre-grow table still exists, and the grow added at most 2 tables
 *
 *   cd sdk/org/scenarios/harness && SCENARIO_TARGET=local node probe-endpoint-table-gate.mjs
 *
 * PROBE_GROW=big makes the grow request CRUD-heavy (several screens, add/edit/delete) so the
 * automator routes it through build_live_project — the exact 06-run-25 path (plan_app CONVERGE +
 * scope rule + the gate scan all exercised ON A GROW) — instead of the freeform grow path a small
 * ask takes.
 */
import { getUser } from './provision.mjs';
import { Pod } from './lib/pod.mjs';
import { ThingSession } from './lib/thing.mjs';

const PROJECT = `probe-etgate-${Date.now().toString(36)}`;
const user = await getUser('etgate');
const pod = new Pod({ base: user.pod, token: user.token });
await pod.createProject(PROJECT);
console.log(`project ${PROJECT}`);

const s = new ThingSession(pod, {
  projectId: PROJECT,
  spaceRef: 'system-appbuilder/automator',
  onAsk: () => ({}),
  verbose: true,
});
await s.start();

/** All project files (relative paths), fresh from the pod. */
const files = async () => {
  const tree = await pod.fsTree();
  return (tree.files ?? [])
    .filter((f) => f.startsWith(`${PROJECT}/`) && !f.includes('/sessions/'))
    .map((f) => f.slice(PROJECT.length + 1));
};
const tablesOf = (fs) =>
  fs.filter((f) => f.startsWith('database/') && f.endsWith('.json')).map((f) => f.slice('database/'.length, -'.json'.length));

// ── 1. FIRST BUILD ─────────────────────────────────────────────────────────
await s.send(
  'Build a small lending-log app INTO this live project. Move this data in as seeded table rows: ' +
    '2 members (name/joined): "Ada"/2026-01-05, "Grace"/2026-02-11; and 1 loan (item/member/due): ' +
    '"Telescope"/Ada/2026-08-01. The app needs a home page listing the loans with member names. ' +
    `Serve it at /app/${PROJECT}/.`,
  { timeoutMs: 1_200_000 },
);
const preFiles = await files();
const preTables = tablesOf(preFiles);
console.log('\nafter FIRST build — tables:', preTables.join(', ') || 'NONE');
if (!preTables.length) {
  console.log('\nVERDICT: ❌ SETUP FAILED — first build produced no tables; grow assertions unreachable');
  process.exit(1);
}

// ── 2. GROW — one new record kind, named ───────────────────────────────────
const BIG = process.env.PROBE_GROW === 'big';
await s.send(
  BIG
    ? 'Add a full damage-reports section to this app — a whole workflow, several screens: a list ' +
        'of all damage reports, a detail view per report, and forms to add, edit and delete them. ' +
        'Each report records which item, who reported it, what is wrong, a severity, and the date. ' +
        'Wire it into the app so I can get to it from the home page.'
    : 'Add a way to record damage reports for returned items — which item, who reported it, what is ' +
        'wrong, and the date. I want to see the reports in the app and add new ones there.',
  { timeoutMs: 1_200_000 },
);
const postFiles = await files();
const postTables = tablesOf(postFiles);
const newTables = postTables.filter((t) => !preTables.includes(t));
console.log('\nafter GROW — tables:', postTables.join(', '));
console.log('new tables:', newTables.join(', ') || 'NONE');

// ── A. mechanical ref scan: every literal db.<verb>('t') in api/** resolves ─
const apiFiles = postFiles.filter((f) => f.startsWith('api/') && f.endsWith('.ts'));
const dangling = [];
const refsByFile = new Map();
for (const f of apiFiles) {
  const src = await pod.readProjectFile(PROJECT, f);
  const refs = [];
  const re = /\bdb\s*\.\s*(?:query|insert|update|remove)\s*\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) refs.push(m[1]);
  refsByFile.set(f, refs);
  for (const t of refs) if (!postTables.includes(t)) dangling.push(`${f} → '${t}'`);
}
const A = dangling.length === 0;

// ── B. the new record kind has a backing table ─────────────────────────────
const B = newTables.length >= 1;

// ── C. a GET endpoint referencing a new table answers (no 5xx) ─────────────
let C = null; // null = not applicable (no such endpoint found)
let cDetail = 'no GET endpoint referencing a new table found';
for (const [f, refs] of refsByFile) {
  if (!f.endsWith('/GET.ts') || f.includes('[')) continue;
  if (!refs.some((t) => newTables.includes(t))) continue;
  const src = await pod.readProjectFile(PROJECT, f);
  const nm = /export\s+const\s+name\s*=\s*['"`]([^'"`]+)['"`]/.exec(src);
  if (!nm) continue;
  const r = await pod.appApi(PROJECT, nm[1], undefined, 'GET').catch((e) => ({ status: 0, body: String(e) }));
  C = r.status > 0 && r.status < 500;
  cDetail = `GET api/${nm[1]} (from ${f}) → ${r.status}`;
  break;
}

// ── D. scope: nothing pre-existing dropped; the grow stays bounded ─────────
const droppedTables = preTables.filter((t) => !postTables.includes(t));
const D = droppedTables.length === 0 && newTables.length <= 2;

console.log('\n──────── RESULT ────────');
console.log(`A. refs resolve  : ${A ? '✅' : '❌'} ${dangling.length ? dangling.join('; ') : 'every literal db ref has a backing table'}`);
console.log(`B. backing table : ${B ? '✅' : '❌'} new tables: ${newTables.join(', ') || 'NONE — the run-25 failure shape'}`);
console.log(`C. endpoint live : ${C === null ? '⚠️ n/a' : C ? '✅' : '❌'} ${cDetail}`);
console.log(`D. scope bounded : ${D ? '✅' : '❌'} dropped: ${droppedTables.join(', ') || 'none'}; added: ${newTables.length}`);
const pass = A && B && (C !== false) && D;
console.log(`\nVERDICT: ${pass ? '✅ gate + scope hold' : '❌ FAIL — see above'}`);
process.exit(pass ? 0 : 1);

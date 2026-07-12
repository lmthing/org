#!/usr/bin/env node
/**
 * Scenario 06 — Tanzania trip: a file attachment becomes spaces + a live, updatable app.
 * Spec: sdk/org/scenarios/06-tanzania-trip-attachment-to-app.md
 *
 * Reproduces the literal user action: create the `tanzania-trip` project, attach
 * `tanzaniamemories.md`, and send the one compound message. Then drives the follow-ups the spec's
 * Acts require and asserts against REAL pod state (spaces on disk, the served app, db rows), not the
 * model's prose.
 *
 * Resumable: checkpoints per Act to results/06-tanzania-checkpoint.json.
 *
 *   node 06-tanzania/run.mjs            # fresh
 *   node 06-tanzania/run.mjs --reuse    # reuse the cached tanzania user + project
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession, approveAllConsent, textOf } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = resolve(HERE, '..', 'results');
const FIXTURE = resolve(HERE, 'fixtures', 'tanzaniamemories.md');
const CKPT = resolve(RESULTS, '06-tanzania-checkpoint.json');
const PROJECT = 'tanzania-trip';

const USER_MESSAGE =
  'I am planning a trip to cairo and tanzania. I have attached all the info. ' +
  'Create multiple spaces for the different parts of the trip and move all this info ' +
  'an application that you can later update on the db based on the info I give you';

// Facts that appear ONLY in the file — used to prove THING actually read the attachment.
const FILE_FACTS = ['Suricata', 'The Rock', 'A3932', 'Ngorongoro', 'Zanzibar', 'Eileen'];
// The trip legs each deserve their own space.
const LEG_HINTS = ['cairo', 'arusha|safari|serengeti|ngorongoro', 'zanzibar', 'dar'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ckpt = existsSync(CKPT) ? JSON.parse(readFileSync(CKPT, 'utf8')) : { acts: {} };
const saveCkpt = () => {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(CKPT, JSON.stringify(ckpt, null, 2));
};

const r = new Report('06-tanzania', 'Tanzania trip: attachment → spaces → live updatable app');

// ── setup ───────────────────────────────────────────────────────────────────
r.step('setup', 'fresh prod user; the tanzania-trip project created (UI action); file uploaded');
const user = await getUser('tanzania', { fresh: !process.argv.includes('--reuse') });
r.check('user provisioned', !!user.userId, `${user.email} (user-${user.userId})`);
const pod = new Pod({ base: user.pod, token: user.token });

// Create the project the way the UI does (project creation is a UI/API action, not a THING turn).
let projectId = PROJECT;
try {
  const created = await pod.createProject(PROJECT);
  projectId = created?.id ?? created?.project?.id ?? PROJECT;
} catch (e) {
  // Already exists on a reused user — fine.
  r.note(`createProject: ${String(e).slice(0, 120)}`);
}
const projects = await pod.listProjects();
r.check(
  'tanzania-trip project exists',
  (projects.projects ?? []).some((p) => p.id === projectId),
  projectId,
);

const attachment = await pod.upload(FIXTURE);
r.check('file uploaded as an attachment', !!attachment.id, `${attachment.kind} ${attachment.mediaType} id=${attachment.id}`);
r.check('classified as a readable file', attachment.kind === 'file', attachment.kind);

const thing = new ThingSession(pod, { projectId, onAsk: approveAllConsent, verbose: true });
await thing.start();
saveCkpt();

// ── Act I — ingest: the attachment is read, not ignored ──────────────────────
r.step('Act I — ingest', 'THING delegates to system-files and its plan cites real file specifics');
const t1 = await thing.sendWithAttachments(USER_MESSAGE, [attachment], { timeoutMs: 1_500_000 });
const readFile =
  thing.didDelegate('system-files') || thing.events.some((e) => e.type === 'yield' && e.kind === 'delegate' && JSON.stringify(e.args).includes('system-files'));
r.check('delegated to system-files (read the attachment)', readFile, thing.turn(0).delegates.join(' · '));
const allText = textOf(thing.events);
const citedFacts = FILE_FACTS.filter((f) => allText.toLowerCase().includes(f.toLowerCase()));
r.check('plan cites ≥3 file-specific facts', citedFacts.length >= 3, `cited: ${citedFacts.join(', ')}`);
r.check('Act I: no eval/typecheck errors', t1.errors.length === 0, JSON.stringify(t1.errors).slice(0, 300));
r.metric('Act I ingest', (t1.durationMs / 1000).toFixed(0), 's');
r.metric('Act I tokens', `${t1.tokens.in}/${t1.tokens.out}`);
ckpt.acts.I = { delegatedFiles: readFile, citedFacts };
saveCkpt();

// THING may build spaces/app across several turns off the one compound ask. Nudge it to finish
// each half explicitly if it stopped after just reading — but only if the state isn't there yet.
async function spacesNow() {
  const s = await pod.listSpaces(projectId).catch(() => ({ spaces: [] }));
  return (s.spaces ?? []).map((x) => (typeof x === 'string' ? x : x.id));
}

// ── Act II — multiple spaces, one per leg ────────────────────────────────────
r.step('Act II — spaces', '≥4 leg spaces (Cairo/Safari/Zanzibar/Dar), each delegatable');
let spaces = await spacesNow();
if (spaces.length < 4) {
  await thing.send(
    'Please make sure each part of the trip has its own space: Cairo, the Arusha safari, ' +
      'Zanzibar, and Dar es Salaam — each with the details from the file.',
    { timeoutMs: 900_000 },
  );
  spaces = await spacesNow();
}
r.check('≥4 spaces created', spaces.length >= 4, spaces.join(', '));
const legHits = LEG_HINTS.filter((rx) => spaces.some((s) => new RegExp(rx, 'i').test(s)));
r.check('spaces cover the 4 trip legs', legHits.length >= 4, `${legHits.length}/4 legs — spaces: ${spaces.join(', ')}`);
ckpt.acts.II = { spaces };
saveCkpt();

// A leg-specific question must route into the right space (delegatable, knowledge present).
const zTurn = await thing.send("What's my dinner reservation in Zanzibar and when?", { timeoutMs: 300_000 });
r.check(
  'a leg question routes into a space and answers from the file',
  /rock/i.test(zTurn.text) && /15/.test(zTurn.text),
  zTurn.text.slice(0, 200),
);

// ── Act III — a real app on the live project ─────────────────────────────────
r.step('Act III — live app', '/app/tanzania-trip builds (built:true) and serves 200 real HTML');
let manifest = await pod.appManifest(projectId).catch(() => ({}));
const appHasData = () => (manifest?.tables ?? manifest?.app?.tables ?? []).length > 0;
if (!manifest?.built && !appHasData()) {
  // Re-attach the file so the automator can readDocument it and seed rows (the app-build half of
  // the compound ask may not have fired yet). Attachment carries through the delegate to the automator.
  await thing.sendWithAttachments(
    'Now build the trip into an app on this project I can open — with the itinerary, flights, ' +
      'accommodations and the safari — and MOVE ALL the info from the attached file into its database as rows.',
    [attachment],
    { timeoutMs: 1_200_000 },
  );
  await pod.appBuild(projectId).catch(() => {});
  manifest = await pod.appManifest(projectId).catch(() => ({}));
}
r.check('app manifest reports built', !!manifest?.built, JSON.stringify(manifest).slice(0, 200));
const tables = manifest?.tables ?? manifest?.app?.tables ?? [];
r.check('app declares tables', (tables?.length ?? 0) > 0, JSON.stringify(tables).slice(0, 200));
r.check('app declares ≥1 page', (manifest?.pages?.length ?? 0) > 0, JSON.stringify(manifest?.pages).slice(0, 150));
const page = await pod.appPage(projectId).catch((e) => ({ status: 0, body: String(e) }));
r.check('/app/tanzania-trip/ serves 200 real HTML', page.status === 200 && String(page.body).includes('<'), `status ${page.status}, ${String(page.body).length} bytes`);
r.metric('/app first byte', page.status, ` (${String(page.body).length} bytes)`);
ckpt.acts.III_app = { built: !!manifest?.built, tables, pages: manifest?.pages };
saveCkpt();

// ── Act IV — the data is IN the db (the crux) ────────────────────────────────
r.step('Act IV — data in db', "the file's flights/accommodations/safari are ROWS, matching the file");
const tableNames = (Array.isArray(tables) ? tables : []).map((t) => (typeof t === 'string' ? t : t.name));
async function rowsOf(name) {
  const guess = tableNames.find((t) => new RegExp(name, 'i').test(t));
  if (!guess) return { table: null, rows: [] };
  const data = await pod.appData(projectId, guess).catch(() => ({ rows: [] }));
  return { table: guess, rows: data.rows ?? data ?? [] };
}
const flights = await rowsOf('flight|itinerary|travel');
const stays = await rowsOf('accommodation|hotel|lodging|stay');
r.check('a flights/itinerary table has rows', flights.rows.length > 0, `${flights.table}: ${flights.rows.length} rows`);
r.check('flights include ≥5 legs from the file', flights.rows.length >= 5, `${flights.rows.length} rows`);
r.check('an accommodations table has rows', stays.rows.length > 0, `${stays.table}: ${stays.rows.length} rows`);
r.check('accommodations include ≥6 stays from the file', stays.rows.length >= 6, `${stays.rows.length} rows`);
// Content match: a couple of unmistakable file facts must appear in the rows.
const allRows = JSON.stringify([flights.rows, stays.rows]).toLowerCase();
r.check('rows contain real file content (Eileen / Suricata / Ngorongoro / A3932)', ['eileen', 'suricata', 'ngorongoro', 'a3932'].some((f) => allRows.includes(f)), allRows.slice(0, 200));
ckpt.acts.IV_data = { flights: flights.rows.length, stays: stays.rows.length, tableNames };
saveCkpt();

// ── Act V — update the db from a later message (the promise) ──────────────────
r.step('Act V — later update', 'a follow-up instruction changes a db row; the app reflects it');
const beforeAll = JSON.stringify(await Promise.all(tableNames.map((t) => pod.appData(projectId, t).catch(() => ({})))));
await thing.send(
  'Record that the safari balance of $960 USD is due in cash on arrival, and note on the Zanzibar ' +
    'leg that a local driving permit (~$15) is required.',
  { timeoutMs: 900_000 },
);
await sleep(3000);
const afterAll = JSON.stringify(await Promise.all(tableNames.map((t) => pod.appData(projectId, t).catch(() => ({})))));
r.check('a db row changed after the follow-up', beforeAll !== afterAll, beforeAll === afterAll ? 'NO CHANGE' : 'changed');
r.check('the change reflects the instruction (960 / driving permit)', /960|driving permit|permit/i.test(afterAll) && !/960|permit/i.test(beforeAll), 'see rows');
ckpt.acts.V_update = { changed: beforeAll !== afterAll };
saveCkpt();

// ── whole-session invariant ──────────────────────────────────────────────────
r.step('invariants', 'no eval/typecheck errors across the whole session');
const sessionErrors = thing.turn(0).errors;
r.check('zero eval/typecheck errors', sessionErrors.length === 0, `${sessionErrors.length}: ${JSON.stringify(sessionErrors).slice(0, 200)}`);
const stats = thing.stats();
r.metric('total LLM calls', stats.llmCalls);
r.metric('total tokens', `${stats.tokens.in}/${stats.tokens.out}`);
r.metric('delegates', stats.delegates.length);

r.save(resolve(RESULTS, '06-tanzania-report.md'));
r.saveTrace(resolve(RESULTS, '06-tanzania-trace.json'), thing);
ckpt.done = true;
ckpt.summary = r.summary();
saveCkpt();
console.log(`\n${r.passed ? '✅ PASS' : '❌ FAIL'} — ${r.summary().passed}/${r.summary().total} checks`);
process.exit(r.passed ? 0 : 1);

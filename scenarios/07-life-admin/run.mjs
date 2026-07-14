#!/usr/bin/env node
/**
 * Scenario 07 — Life-admin vault — executable acceptance contract.
 *
 * Acts I–XIV mirror scenario.md. Assertions read trace events and durable project
 * state; persona turns deliberately contain no product terminology.
 *
 * SCENARIO_TARGET=local node scenarios/07-life-admin/run.mjs --acts=1 --fresh
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';
import { waitPodReady } from '../harness/lib/gateway.mjs';
import { SDK_ORG } from '../harness/lib/paths.mjs';

const ID = '07-life-admin';
const TITLE = 'Life-admin vault: a household app that stays safe while it grows';
const LABEL = '07-life-admin';
const PROJECT = 'life-admin';
const FIXTURES = `${SDK_ORG}/scenarios/${ID}/fixtures`;
const RESULTS = `${SDK_ORG}/scenarios/${ID}/results`;
const CHECKPOINT = `${RESULTS}/checkpoint.json`;
const TURN = 1_500_000;
const ALL_ACTS = Array.from({ length: 14 }, (_, index) => index + 1);
const requested = (process.argv.find((arg) => arg.startsWith('--acts=')) ?? '').slice(7);
const ACTS = requested ? requested.split(',').map(Number) : ALL_ACTS;
const FRESH = process.argv.includes('--fresh');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Date.now();

function loadCheckpoint() {
  if (FRESH || !existsSync(CHECKPOINT)) return { acts: {}, facts: {}, sessionId: null };
  try {
    const checkpoint = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
    checkpoint.acts ??= {};
    checkpoint.facts ??= {};
    return checkpoint;
  } catch {
    return { acts: {}, facts: {}, sessionId: null };
  }
}

function saveCheckpoint(checkpoint) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify(checkpoint, null, 2));
  console.log(`checkpoint → ${CHECKPOINT}`);
}

const scriptedOnAsk = (consent) => (descriptor) => {
  if (descriptor?.type === 'ConsentCard') return consent;
  if (descriptor?.type) return {};
  return undefined;
};

async function allRows(pod, projectId) {
  const manifest = await pod.appManifest(projectId).catch(() => ({}));
  const names = (manifest.tables ?? []).map((table) => (typeof table === 'string' ? table : table.name));
  const rows = {};
  for (const name of names) rows[name] = (await pod.appData(projectId, name).catch(() => ({ rows: [] }))).rows ?? [];
  return rows;
}

async function files(pod, prefix = '') {
  const tree = await pod.fsTree().catch(() => ({ files: [] }));
  return (tree.files ?? []).filter((path) => path.startsWith(prefix));
}

async function grepFiles(pod, prefix, token) {
  const hits = [];
  for (const path of await files(pod, prefix)) {
    const raw = await pod.readFile(path).catch(() => null);
    const body = typeof raw === 'string' ? raw : raw?.content ?? '';
    if (body.toLowerCase().includes(token.toLowerCase())) hits.push(path);
  }
  return hits;
}

function matchingTable(rows, words) {
  return Object.keys(rows).find((name) => words.some((word) => name.toLowerCase().includes(word)));
}

async function tokenInState(report, pod, token, fixture) {
  const hits = [];
  for (const [table, rows] of Object.entries(await allRows(pod, PROJECT))) {
    if (rows.some((row) => JSON.stringify(row).toLowerCase().includes(token.toLowerCase()))) hits.push(`db:${table}`);
  }
  if (!hits.length) hits.push(...(await grepFiles(pod, `${PROJECT}/spaces/`, token)).map((path) => `file:${path}`));
  report.check(`${fixture}: unique token ${token} landed in real state`, hits.length > 0, hits.join(', ') || 'not found');
  return hits;
}

async function assertLiveApp(report, pod) {
  const build = await pod.appBuild(PROJECT).catch((error) => ({ built: false, error: String(error) }));
  report.check('the vault compiles with real JavaScript assets', build.built === true && (build.assetManifest ?? []).some((asset) => asset.endsWith('.js')), JSON.stringify(build).slice(0, 180));
  report.check('the vault has a served page route', (build.routes ?? []).length > 0, JSON.stringify(build.routes ?? []).slice(0, 180));
  const page = await pod.appPage(PROJECT).catch((error) => ({ status: 0, body: String(error) }));
  report.check('the served vault page returns HTML', page.status === 200 && String(page.body).toLowerCase().includes('<!doctype'), `status ${page.status}`);
  return build;
}

async function sessions(pod) {
  return (await pod.req('GET', '/api/sessions').catch(() => ({ sessions: [] }))).sessions ?? [];
}

async function drainNewSessions(pod, before, waitMs = 20_000) {
  const start = now();
  let discovered = [];
  while (now() - start < waitMs) {
    discovered = (await sessions(pod)).filter((session) => !before.has(session.sessionId));
    if (discovered.every((session) => session.status === 'idle')) break;
    await sleep(1_000);
  }
  const events = [];
  for (const session of discovered) {
    const trace = await pod.req('GET', `/api/sessions/${session.sessionId}/events?since=0&format=json`).catch(() => ({ events: [] }));
    events.push(...(trace.events ?? []).map((entry) => entry.event));
  }
  return { discovered, events };
}

const report = new Report(ID, TITLE);
const checkpoint = loadCheckpoint();
const started = now();
const user = await getUser(LABEL);
console.log(`user ${user.email} (${user.userId}) → ${user.pod}`);
const pod = new Pod({ base: user.pod, token: user.token });
if (!(await pod.listProjects()).projects?.some((project) => (project.id ?? project) === PROJECT)) await pod.createProject(PROJECT);
checkpoint.projectId = PROJECT;
checkpoint.user = { label: LABEL, email: user.email, userId: user.userId };
const thing = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
if (checkpoint.sessionId && !FRESH) {
  try { await thing.resume(checkpoint.sessionId); } catch { checkpoint.sessionId = await thing.start(); }
} else {
  checkpoint.sessionId = await thing.start();
}
await thing.syncToTail();
saveCheckpoint(checkpoint);
const keepalive = setInterval(() => pod.req('POST', '/api/keepalive', {}).catch(() => {}), 30_000);
keepalive.unref?.();

const send = async (message, options = {}) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await thing.send(message, { timeoutMs: TURN, ...options }); }
    catch (error) {
      if (attempt === 2) throw error;
      await waitPodReady(user.token).catch(() => {});
      checkpoint.sessionId = await thing.start();
      await thing.syncToTail();
      saveCheckpoint(checkpoint);
    }
  }
};
const sendAttachments = async (message, attachments, options = {}) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await thing.sendWithAttachments(message, attachments, { timeoutMs: TURN, ...options }); }
    catch (error) {
      if (attempt === 2) throw error;
      await waitPodReady(user.token).catch(() => {});
      checkpoint.sessionId = await thing.start();
      await thing.syncToTail();
      saveCheckpoint(checkpoint);
    }
  }
};
const timed = async (label, operation) => {
  const start = now();
  const value = await operation();
  report.metric(label, ((now() - start) / 1000).toFixed(0), ' s');
  return value;
};
const finishAct = (act) => { checkpoint.acts[act] = { passed: report.stepPassed }; saveCheckpoint(checkpoint); };

// ═══ ACT I — multi-modal household dump and an unprompted offer ════════════════
if (ACTS.includes(1)) {
  report.step('Act I — Ingest & THING proposes the vault', 'One compound upload is read; THING offers an openable place before a bare yes starts authoring.');
  const uploaded = await Promise.all([
    'policies.md', 'policy.pdf', 'policy-photo.jpg', 'product-photo.png',
    'household-ledger.xlsx', 'voice-memo.mp3', 'boiler-service-manual.pdf',
  ].map((name) => pod.upload(`${FIXTURES}/${name}`)));
  report.check('all seven household files uploaded', uploaded.length === 7, uploaded.map((item) => item.mediaType).join(', '));
  const offerTurn = await timed('Act I — household dump to offer', () => sendAttachments(
    "Hi — sorry, I'm going to dump a lot on you at once. Attaching our insurance stuff, a photo of the plumber receipt, a photo of something we bought, our bills-and-warranties spreadsheet, a voice note about the boiler, and its manual. I am useless at keeping on top of this. Last year our home insurance nearly lapsed because I completely forgot. Can you help me get on top of this before it happens again?",
    uploaded,
  ));
  const delegateText = offerTurn.delegates.join(' ');
  report.check('the compound message reached file reading', /system-files/i.test(delegateText), delegateText || 'no file delegate');
  report.check('the compound message reached vision', /system-vision|vision/i.test(delegateText), delegateText || 'no vision delegate');
  const offer = offerTurn.lastText || offerTurn.text;
  report.check('THING offered something openable before being asked for one', /want me to|would you like|shall i|i can (?:put|make|build|set)|i could (?:put|make|build|set)/i.test(offer) && /open|check|look|phone|place|track/i.test(offer), offer.slice(0, 260));
  report.check('the offer is a question that a bare yes can answer', /\?/.test(offer), offer.slice(0, 260));
  report.check('there was no unrecovered error before consent', thing.unrecoveredErrors().length === 0, JSON.stringify(offerTurn.errors).slice(0, 160));
  const yesTurn = await timed('Act I — bare yes', () => send('yes please, go for it'));
  report.check('the bare yes produced further work', yesTurn.events.length > 0, `${yesTurn.events.length} trace events`);
  await assertLiveApp(report, pod);
  const spaces = await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] }));
  const localSpaces = (spaces.spaces ?? []).filter((space) => !String(space.id ?? space.spaceId ?? space).startsWith('system-'));
  report.check('THING created at least three per-topic spaces itself', localSpaces.length >= 3, JSON.stringify(localSpaces).slice(0, 240));
  for (const [fixture, token] of [
    ['policies.md', 'AX-7741-VAULT'], ['policy.pdf', '2746423'], ['policy-photo.jpg', 'receipt No. 2273'],
    ['product-photo.png', 'STE-042455-P42455'], ['household-ledger.xlsx', 'BLR-ZWB30-208841'],
    ['voice-memo.mp3', 'Kostas Xenakis'], ['boiler-service-manual.pdf', '6 720 613 085-00.1O'],
  ]) await tokenInState(report, pod, token, fixture);
  checkpoint.facts.act1Tables = Object.keys(await allRows(pod, PROJECT));
  checkpoint.facts.act1Routes = (await pod.appBuild(PROJECT).catch(() => ({ routes: [] }))).routes ?? [];
  finishAct('I');
}

// ═══ ACT II — research becomes durable knowledge and a real row ═════════════════
if (ACTS.includes(2)) {
  report.step('Act II — Automatic research → knowledge + rows', 'A plain question causes live research, durable knowledge, and a researched fact in the vault.');
  const before = await allRows(pod, PROJECT);
  const researchTurn = await timed('Act II — electricity question', () => send("is there anything cheaper than what we're on for electricity? this ΔΕΗ bill feels like a lot"));
  const lookups = researchTurn.yields.filter((yielded) => ['webSearch', 'webFetch', 'fetch'].includes(yielded.kind));
  report.check('delegated to live research', thing.didDelegate('system-research'), researchTurn.delegates.join(', ') || 'none');
  report.check('the research turn performed a live lookup', lookups.length > 0, `${lookups.length} lookup yields`);
  const after = await allRows(pod, PROJECT);
  const addedRows = Object.entries(after).some(([table, rows]) => rows.length > (before[table] ?? []).length && /option|quote|tariff|electric/i.test(table));
  report.check('a research result landed as a real option/quote row', addedRows, JSON.stringify(after).slice(0, 280));
  const knowledgeHits = await grepFiles(pod, `${PROJECT}/spaces/`, '6 720 613 085-00.1O');
  report.check('the boiler manual token landed in a specialist knowledge file', knowledgeHits.some((path) => path.includes('/knowledge/')), knowledgeHits.join(', ') || 'not found');
  const spaces = await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] }));
  const specialist = (spaces.spaces ?? []).map((space) => space.id ?? space.spaceId ?? space).find((id) => /bill|electric|utility|home|boiler/i.test(String(id)));
  if (specialist) {
    const specialistSession = new ThingSession(pod, { projectId: PROJECT, spaceRef: `${specialist}/main`, onAsk: scriptedOnAsk(true), verbose: true });
    try {
      await specialistSession.start();
      const answer = await specialistSession.send('What did you find about the electricity price?', { timeoutMs: TURN });
      report.check('a project specialist can answer from its own knowledge', answer.events.length > 0 && answer.errors.length === 0, answer.lastText.slice(0, 180));
    } catch (error) {
      report.check('a project specialist can answer from its own knowledge', false, String(error).slice(0, 180));
    }
  } else {
    report.check('a project specialist can answer from its own knowledge', false, 'no bills/home specialist discovered');
  }
  finishAct('II');
}

// ═══ ACT III — the live schema grows without data loss ══════════════════════════
if (ACTS.includes(3)) {
  report.step('Act III — Live schema migration', 'The gas-meter fact adds a live column and preserves existing bills exactly.');
  const beforeRows = await allRows(pod, PROJECT);
  const bills = matchingTable(beforeRows, ['bill', 'utility', 'charge']);
  const preserved = (beforeRows[bills] ?? []).filter((row) => /PPC|EYDAP|gas/i.test(JSON.stringify(row))).map((row) => ({ id: row.id, amount: row.amount, month: row.month, due: row.due }));
  report.check('there is a seeded bills-shaped table to migrate', !!bills && preserved.length > 0, `${bills ?? 'none'}: ${preserved.length} rows`);
  const turn = await timed('Act III — meter reading', () => send("also can you start keeping the gas meter number next to the bill? I write it down every time the engineer comes, don't want us ever getting overcharged. the last one was 04821.6"));
  const afterRows = await allRows(pod, PROJECT);
  const changed = afterRows[bills] ?? [];
  const meterRow = changed.find((row) => JSON.stringify(row).includes('04821.6'));
  const newColumn = meterRow && Object.keys(meterRow).find((key) => /meter|reading/i.test(key));
  report.check('the meter reading landed on a structured bill row', !!meterRow && !!newColumn, meterRow ? JSON.stringify(meterRow).slice(0, 240) : 'no reading row');
  const ddl = turn.yields.some((yielded) => /addColumn|createTable|schema/i.test(yielded.kind)) || /addColumn|ALTER TABLE/i.test(JSON.stringify(turn.events));
  report.check('the trace shows a live schema path rather than a table rewrite', ddl, turn.yields.map((yielded) => yielded.kind).join(', '));
  const intact = preserved.every((snapshot) => changed.some((row) => row.id === snapshot.id && row.amount === snapshot.amount && row.month === snapshot.month && row.due === snapshot.due));
  report.check('pre-existing PPC/EYDAP/gas row values survived unchanged', intact, JSON.stringify({ before: preserved, after: changed.slice(0, 4) }).slice(0, 380));
  finishAct('III');
}

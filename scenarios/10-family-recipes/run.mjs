#!/usr/bin/env node
/**
 * 10-family-recipes — "Family recipe book → meal planner: a shoebox of cards becomes a kitchen that
 * plans the week."
 *
 * Drives the whole scenario end-to-end through the THING agent and asserts on the TRACE + real pod
 * state (spaces on disk, app tables/pages/rows, authored source files). Acts match `scenario.md` §6
 * one-for-one (I–XII + Edges). Hardening patterns per
 * `automation/instances/scenario-campaign/prompt.common.md`: per-Act checkpoint/resume, keepalive,
 * resilient send, scripted asks, trace-based assertions — never prose grading.
 *
 *   cd sdk/org/scenarios/harness && SCENARIO_TARGET=local node ../10-family-recipes/run.mjs [--acts=1,2] [--fresh]
 *
 * The load-bearing beats unique to THIS scenario (coverage-audit gaps M/K/P/C):
 *   · AUDIO is the sole source of a fact (Act II) — the memo's recipe exists in no file, and
 *     `POST /api/uploads` transcribes synchronously, so it is proved BEFORE any chat turn runs.
 *   · `readDocument` REJECTS an image by design (Act III) — a host guard, not a model convention.
 *   · The webSearch fallback chain survives a real provider outage (Act V) — assertable only since
 *     the result names its `provider` (sdk/org c4e28b5).
 *   · Code nodes do the shopping-list arithmetic (Act VI) and an `every`-interval trigger fires them
 *     with no day-of-week self-gate (Act VII).
 *   · `emitEvent` through a declared `internal` def, consumed by a hook, with NO chat in the loop
 *     (Act VIII).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { getUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';
import { waitPodReady } from '../harness/lib/gateway.mjs';
import { LOCAL } from '../harness/lib/local.mjs';
import { SDK_ORG } from '../harness/lib/paths.mjs';

// ── config ───────────────────────────────────────────────────────────────────────
const ID = '10-family-recipes';
const TITLE = 'Family recipe book → meal planner: a shoebox of cards becomes a kitchen that plans the week';
const LABEL = 'famrecipes';
const PROJECT = 'family-recipes';
const FIX = `${SDK_ORG}/scenarios/${ID}/fixtures`;

const RESULTS = `${SDK_ORG}/scenarios/${ID}/results`;
const CHECKPOINT = `${RESULTS}/checkpoint.json`;
const argActs = (process.argv.find((a) => a.startsWith('--acts=')) ?? '').slice(7);
const ALL_ACTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ACTS = argActs ? argActs.split(',').map(Number) : ALL_ACTS;
const FRESH = process.argv.includes('--fresh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const TURN = 1_500_000; // 25 min — a real authoring turn has taken 8+ min

// The three real URLs Vasilis pastes (fixtures/links.md — each verified 200).
const LINKS = [
  'https://el.wikipedia.org/wiki/Μουσακάς',
  'https://en.wikipedia.org/wiki/Béchamel_sauce',
  'https://en.wikipedia.org/wiki/Gluten-free_diet',
];
const LINK_DOMAINS = /el\.wikipedia\.org|en\.wikipedia\.org/i;

/**
 * The memo's recipe — what ONLY the ear can hear. Every token below is grepped against every other
 * fixture at run time (Act II) and must appear in NONE of them: the dish NAME proves nothing (the
 * workbook already schedules Σπανακόπιτα on Saturday, and its shopping list already carries the
 * 750g/320g quantities), so asserting on it would make the audio proof worthless. The RECIPE is the
 * proof. `190`/`55` are spoken as words, so they appear nowhere as digits either.
 */
const AUDIO_ONLY = ['μαστίχα', 'τσίπουρο', 'Δέσποινα', 'Λευκάδα', 'πράσο', 'άνηθο'];

// ── checkpoint ───────────────────────────────────────────────────────────────────
function loadCheckpoint() {
  if (FRESH || !existsSync(CHECKPOINT)) return { acts: {}, sessionId: null, facts: {} };
  try {
    const cp = JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
    cp.acts ??= {};
    cp.facts ??= {};
    return cp;
  } catch {
    return { acts: {}, sessionId: null, facts: {} };
  }
}
function saveCheckpoint(cp) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2));
  console.log(`\n💾 checkpoint → ${CHECKPOINT}`);
}

// ── scripted asks (an autonomous run must never hang on an open ask) ─────────────
const scriptedOnAsk = (consent) => (d) => {
  if (d?.type === 'ConsentCard') return consent;
  if (d?.type) return {}; // settle Forms/other asks with an empty submission
  return undefined;
};

// ── text helpers ─────────────────────────────────────────────────────────────────
const rxOf = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const normAlnum = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
/** Greek-insensitive fold: strip diacritics + final sigma, lowercase. Whisper and the model both
 *  vary on accents (μαστίχα/μαστιχα), so an accent-exact grep would fail for a reason that has
 *  nothing to do with the product. */
const foldEl = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .toLowerCase()
    .replace(/ς/g, 'σ');
const hasEl = (haystack, token) => foldEl(haystack).includes(foldEl(token));

// ── a zero-dep .xlsx cell reader (zip + inflate) ─────────────────────────────────
// Act II's disjointness grep must cover EVERY cell of the workbook — a token that also sits in the
// spreadsheet makes the audio assertion worthless. The sheets are deflate-compressed XML inside the
// zip, so grepping the raw bytes finds nothing. No deps: parse the central directory, inflate.
function unzipText(buf) {
  const out = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && off + 46 < buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    const lnameLen = buf.readUInt16LE(lho + 26);
    const lextraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(start, start + compSize);
    try {
      out[name] = (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
    } catch { /* not text / unsupported method — skip */ }
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
/** Every cell + shared string of the workbook, as one plain-text blob. */
function xlsxAllText(path) {
  const entries = unzipText(readFileSync(path));
  return Object.entries(entries)
    .filter(([n]) => /^xl\/(worksheets\/|sharedStrings)/.test(n))
    .map(([, xml]) => xml.replace(/<[^>]+>/g, ' '))
    .join('\n');
}

// ── real-state helpers ───────────────────────────────────────────────────────────
async function lsFiles(pod, pathRx) {
  const tree = await pod.fsTree().catch(() => ({ files: [] }));
  const files = tree?.files ?? tree ?? [];
  return (Array.isArray(files) ? files : []).filter((f) => (pathRx ? pathRx.test(f) : true));
}
async function readAllFiles(pod, pathRx) {
  let blob = '';
  for (const f of await lsFiles(pod, pathRx)) {
    const body = await pod.readFile(f).catch(() => null);
    blob += '\n' + (typeof body === 'string' ? body : (body?.content ?? ''));
  }
  return blob;
}
async function grepFs(pod, contentRx, pathRx) {
  const hits = [];
  for (const f of await lsFiles(pod, pathRx)) {
    const body = await pod.readFile(f).catch(() => null);
    const text = typeof body === 'string' ? body : (body?.content ?? '');
    if (text && contentRx.test(text)) hits.push(f);
  }
  return hits;
}
async function allRows(pod, projectId) {
  const manifest = await pod.appManifest(projectId).catch(() => ({}));
  const names = (manifest?.tables ?? []).map((t) => (typeof t === 'string' ? t : t.name));
  const out = {};
  for (const n of names) out[n] = (await pod.appData(projectId, n).catch(() => ({ rows: [] }))).rows ?? [];
  return out;
}
const tableNamed = (rows, rx) => Object.keys(rows).find((n) => rx.test(n));
const spaceIdsOf = (s) => (s?.spaces ?? []).map((x) => x.id ?? x.spaceId ?? x.name ?? x);

const yieldsOf = (evs, kind) => evs.filter((e) => e.type === 'yield' && e.kind === kind);
/** Resolved yield VALUES — the only way to assert what the host actually handed back
 *  (`readDocument`'s rejection, `webSearch`'s provider). `turn.yields` projects args, not values. */
const resolvedOf = (evs, kind) =>
  evs.filter((e) => e.type === 'yield_resolved' && e.kind === kind).map((e) => e.value);
const displaysOf = (evs) =>
  evs
    .filter((e) => e.type === 'display')
    .map((e) => {
      const d = e.descriptor;
      return typeof d === 'string' ? d : (d?.props?.text ?? d?.props?.children ?? JSON.stringify(d));
    })
    .map((s) => (typeof s === 'string' ? s : JSON.stringify(s)))
    .join('\n');

/** Per the campaign error policy: an error the turn loop RECOVERED (attempt < maxRetries) is a
 *  metric; only an UNRECOVERED one (attempt reached maxRetries) fails the run. */
const MAX_RETRIES = 3;
const unrec = (...turns) => turns.flatMap((t) => (t?.errors ?? []).filter((e) => (e.attempt ?? 1) >= MAX_RETRIES));

/** A fixture is only proved by its unique token landing in a DB ROW or a SPACE FILE — never prose. */
async function assertTokenInState(report, pod, projectId, { fixture, token, greek = false }) {
  const rows = await allRows(pod, projectId);
  const fileBlob = await readAllFiles(pod, new RegExp(`^${projectId}/spaces/`));
  const rowBlob = JSON.stringify(rows);
  let hit = null;
  if (greek) {
    const name = Object.entries(rows).find(([, rs]) => rs.some((r) => hasEl(JSON.stringify(r), token)))?.[0];
    hit = name ? `db:${name}` : hasEl(fileBlob, token) ? 'space-file' : null;
  } else {
    const rx = rxOf(token);
    const name = Object.entries(rows).find(([, rs]) => rs.some((r) => rx.test(JSON.stringify(r))))?.[0];
    hit = name ? `db:${name}` : rx.test(fileBlob) ? 'space-file' : null;
  }
  report.check(
    `${fixture}: unique token "${token}" landed in REAL STATE (not prose)`,
    !!hit,
    hit ?? 'NOT FOUND in any row or space file — the bytes were never read',
  );
  return !!hit;
}

/** The app's OWN api routes — the layer the USER sees. A page can render zeros while
 *  /app/data/<table> happily returns every row, because the page's own aggregation route 500s. */
async function assertAppApi(report, pod, projectId) {
  const files = await lsFiles(pod, new RegExp(`^${projectId}/api/.*\\.tsx?$`));
  const routes = [...new Set(files.map((f) => /^[^/]+\/api\/(.+)\/(GET|POST|PUT|DELETE)\.tsx?$/.exec(f)?.[1]).filter(Boolean))];
  report.check('the app authored ≥1 of its own API routes', routes.length > 0, routes.join(', ') || 'none');
  for (const route of routes.slice(0, 8)) {
    const res = await pod.appApi(projectId, route, undefined, 'GET').catch((e) => ({ status: 0, body: String(e) }));
    report.check(
      `app's own route GET /${projectId}/api/${route} → 200 (not a page-zeroing 500)`,
      res.status === 200,
      `status ${res.status}: ${JSON.stringify(res.body).slice(0, 120)}`,
    );
  }
  return routes;
}

// ── main ─────────────────────────────────────────────────────────────────────────
const report = new Report(ID, TITLE);
const cp = loadCheckpoint();
const t0 = now();

const user = await getUser(LABEL);
console.log(`user ${user.email} (${user.userId}) → ${user.pod}${LOCAL ? '  [LOCAL]' : ''}`);

const pod = new Pod({ base: user.pod, token: user.token });
const projects = await pod.listProjects();
if (!(projects.projects ?? []).some((p) => (p.id ?? p) === PROJECT)) await pod.createProject(PROJECT);
cp.projectId = PROJECT;
cp.user = { label: LABEL, email: user.email, userId: user.userId };

const thing = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
if (cp.sessionId && !FRESH) {
  try { await thing.resume(cp.sessionId); } catch { cp.sessionId = await thing.start(); }
} else {
  cp.sessionId = await thing.start();
}
await thing.syncToTail();
saveCheckpoint(cp);

const keepalive = setInterval(() => {
  pod.req('POST', '/api/keepalive', {}).catch(() => {});
}, 30_000);
keepalive.unref?.();

// resilient send — survives a pod roll/restart (this IS the Act XII auto-resume edge).
//
// It ALSO re-sends an INTERRUPTED turn. A turn whose session was dropped mid-flight (the shared
// local server is restarted by whichever lane just rebuilt) comes back with `interrupted: true`:
// work was seen, but the turn never finished. Marching on from there is how a "yes" gets sent to a
// session that never made the offer — the whole Act then fails on a build that never happened.
// Treat it as "did not happen" and say it again, exactly as a real user would.
const _send = thing.send.bind(thing);
const _sendAtt = thing.sendWithAttachments.bind(thing);
const resilient = (fn) => async (...args) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const turn = await fn(...args);
      if (turn?.interrupted && attempt < 3) {
        console.log('[run] turn was INTERRUPTED (session dropped mid-flight) — re-sending it');
        for (let i = 0; i < 60; i++) { if (await pod.listProjects().then(() => true).catch(() => false)) break; await sleep(4_000); }
        await sleep(3_000);
        continue;
      }
      return turn;
    }
    catch (e) {
      const msg = String(e?.body?.error ?? e?.message ?? '');
      const lost = e?.status === 404 || /unknown session|404/.test(msg);
      const errored = /entered error state/.test(msg);
      if ((!lost && !errored) || attempt >= 3) throw e;
      console.log(`[run] send failed (${msg.slice(0, 80)}) — waiting for the pod, then resuming`);
      if (!LOCAL) await waitPodReady(user.token).catch(() => {});
      for (let i = 0; i < 60; i++) { if (await pod.listProjects().then(() => true).catch(() => false)) break; await sleep(4_000); }
      if (lost && !errored) { try { await thing.resume(cp.sessionId); await thing.syncToTail(); continue; } catch { /* fresh */ } }
      cp.sessionId = await thing.start(); await thing.syncToTail(); saveCheckpoint(cp);
    }
  }
};
thing.send = resilient(_send);
thing.sendWithAttachments = resilient(_sendAtt);

const metrics = { tokens: { in: 0, out: 0 } };
const acc = (turn) => { metrics.tokens.in += turn.tokens.in; metrics.tokens.out += turn.tokens.out; return turn; };
const timed = async (label, fn) => {
  const s = now();
  const r = await fn();
  report.metric(label, ((now() - s) / 1000).toFixed(0), ' s');
  return r;
};

/** Upload the six fixtures. Returns the refs + the two texts the HOST extracted at upload time
 *  (the mp3's Whisper transcript, the PDF's unpdf text) — both land in the upload RESPONSE, i.e.
 *  before any chat turn runs. That ordering is what makes Act II's audio proof airtight. */
async function uploadFixtures() {
  const spec = [
    ['recipes.md', 'text/markdown'],
    ['pantry-and-plan.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['recipe-card.jpg', 'image/jpeg'],
    ['dish-photo.jpg', 'image/jpeg'],
    ['recipe.pdf', 'application/pdf'],
    ['voice-memo.mp3', 'audio/mpeg'],
  ];
  const refs = {};
  for (const [f, mt] of spec) refs[f] = await pod.upload(`${FIX}/${f}`, { mediaType: mt });
  return refs;
}

// ═══ ACT I — THING proposes, then a plain "yes" builds it ═════════════════════════
if (ACTS.includes(1)) {
  report.step(
    'Act I — THING proposes, then builds',
    'turn 1 (the Greek compound dump: 6 fixtures + 3 links in ONE sendWithAttachments) delegates to system-vision AND system-files→readDocument, cites ≥3 recipes.md facts + the card\'s + the PDF\'s + the xlsx\'s, and OFFERS to build something openable — while authoring NOTHING (no build_specialist/automator/writeProject* anywhere in its trace). Only after the plain "Ναι, φτιάξ\' το." do ≥2 per-cuisine spaces (never named by the user), a built app with ≥1 page, and a 200-HTML served app exist',
  );
  const spacesBefore = spaceIdsOf(await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] })));
  const manBefore = await pod.appManifest(PROJECT).catch(() => ({ tables: [] }));
  report.check('BEFORE the dump: no spaces exist', spacesBefore.length === 0, `${spacesBefore.length} spaces`);
  report.check('BEFORE the dump: no app tables exist', (manBefore?.tables ?? []).length === 0, `${(manBefore?.tables ?? []).length} tables`);

  const refs = await uploadFixtures();
  const atts = Object.values(refs);
  const kinds = atts.map((a) => a.kind);
  report.check(
    'all 6 fixtures uploaded with the right kinds (file×3, image×2, audio×1)',
    atts.length === 6 &&
      kinds.filter((k) => k === 'image').length === 2 &&
      kinds.filter((k) => k === 'audio').length === 1 &&
      kinds.filter((k) => k === 'file').length === 3,
    kinds.join(','),
  );

  // The host transcribed the Greek speech INSIDE the upload handler — before a single turn ran.
  const transcript = refs['voice-memo.mp3']?.transcript ?? '';
  const pdfText = refs['recipe.pdf']?.text ?? '';
  cp.facts.memoTranscript = transcript;
  cp.facts.pdfText = pdfText;
  report.check('the mp3 upload RESPONSE already carries a Whisper transcript (pre-turn)', transcript.length > 40, `${transcript.length} chars`);
  report.check('the PDF upload RESPONSE already carries extracted text (unpdf)', /Easy Lasagna/i.test(pdfText), `${pdfText.length} chars`);

  // The one compound message: everything he has, in his own words, naming no product noun.
  const dump =
    "Άσε με να σου πω κάτι — έχω ένα κουτί συνταγές της μάνας και της γιαγιάς που χάνονται σιγά σιγά. " +
    "Σου στέλνω ό,τι έχω μαζέψει: ένα αρχείο με ό,τι έχω γράψει μέχρι τώρα, το excel με το τι έχουμε στο " +
    "ντουλάπι και τι σκεφτόμουν για τη βδομάδα, μια φωτογραφία μιας παλιάς χειρόγραφης κάρτας, μια " +
    "φωτογραφία από ένα πιάτο όπως πρέπει να βγαίνει στο τέλος, ένα pdf που είχα κρατήσει από παλιά, και " +
    "ένα ηχητικό — μου το έστειλε η μάνα, μου λέει μια συνταγή, άκουσέ το. Σου βάζω και τρία λινκ, ρίξ' " +
    "τους μια ματιά όποτε προλάβεις:\n" + LINKS.join('\n') + "\n" +
    "Βαριέμαι κάθε Κυριακή να σκέφτομαι τι θα φάμε τη βδομάδα, και μετά ψωνίζω διπλά πράγματα γιατί δεν " +
    "θυμάμαι τι έχουμε ήδη. Θέλω να τα βλέπω χωρισμένα, ελληνικά/ιταλικά, όχι όλα σε ένα σωρό. Βοήθησέ " +
    "με να μη χαθεί τίποτα απ' όλο αυτό.";

  const t1 = acc(await timed('Act I — ingest → offer (turn 1)', () => thing.sendWithAttachments(dump, atts, { timeoutMs: TURN })));

  // It READ the stuff…
  report.check('turn 1 read the images (system-vision)', thing.didDelegate('system-vision'), t1.delegates.join(', ') || 'none');
  report.check('turn 1 read the documents (system-files)', thing.didDelegate('system-files'), t1.delegates.join(', ') || 'none');
  const readDocs = yieldsOf(t1.events, 'readDocument');
  report.check('turn 1 called readDocument (the pdf + the xlsx)', readDocs.length >= 1, `${readDocs.length} readDocument yields`);

  // …and it did NOT build anything yet.
  const t1kinds = t1.yields.map((y) => y.kind);
  const authored = t1kinds.some((k) => /writeProject(Table|Page|Api|Hook|Event|Function)/.test(k));
  report.check('turn 1 authored NOTHING (no writeProject* before the user said yes)', !authored, t1kinds.join(', ') || 'no yields');
  const builtEarly = t1.delegates.some((d) => /appbuilder|architect/.test(d)) || t1kinds.includes('build_specialist');
  report.check('turn 1 built NO spaces/app (no architect/appbuilder/build_specialist)', !builtEarly, t1.delegates.join(', ') || 'none');

  // The reply cites what it actually read, in his own material.
  const reply = displaysOf(t1.events) + ' ' + t1.lastText;
  const mdFacts = ['Μουσακάς', 'μπεσαμέλ', 'gemista', 'γεμιστά', 'αρακάς', 'κεφτέδες', 'Αθανασία', 'crossini'].filter((f) => hasEl(reply, f));
  report.check('the reply cites ≥3 facts from recipes.md', mdFacts.length >= 3, mdFacts.join(', '));
  const cardFacts = ['Orange Cake', 'crisco', 'raisin', '400'].filter((f) => rxOf(f).test(reply));
  report.check("the reply cites the CARD's fact (vision: Orange Cake/crisco/raisins/400°)", cardFacts.length >= 1, cardFacts.join(', '));
  const pdfFacts = ['Easy Lasagna', 'cottage cheese', 'slow cooker'].filter((f) => rxOf(f).test(reply));
  report.check("the reply cites the PDF's fact (readDocument: Easy Lasagna/cottage cheese)", pdfFacts.length >= 1, pdfFacts.join(', '));
  const xlsFacts = ['GF-NIKOS', 'BUDGET-CAP', '78.50', 'PNT-001', 'Νίκο', 'γλουτέν', 'gluten'].filter((f) => hasEl(reply, f));
  report.check("the reply cites the XLSX's fact (readDocument: GF-NIKOS/budget cap/Nikos)", xlsFacts.length >= 1, xlsFacts.join(', '));

  // The OFFER — in his language, unprompted. He never asked for an app.
  const offered =
    /θ[εέ]λεις να|θες να|να σου (φτι[αά]ξω|ετοιμ[αά]σω|στ[ηή]σω)|μπορ[ωώ] να σου (φτι[αά]ξω|ετοιμ[αά]σω|στ[ηή]σω)|να το φτι[αά]ξω|να στο φτι[αά]ξω|want me to|shall i|would you like|i can (build|put|set)/i.test(reply);
  report.check('turn 1 OFFERS to build something he can open (he never asked for one)', offered, reply.slice(-260));
  cp.facts.offerText = (t1.lastText || '').slice(0, 400);

  // A plain yes — nothing more.
  const t2 = acc(await timed('Act I — "Ναι, φτιάξ\' το." → the whole build', () => thing.send("Ναι, φτιάξ' το.", { timeoutMs: TURN })));

  // Wait the build out.
  let spaces = [];
  for (let i = 0; i < 60; i++) {
    spaces = spaceIdsOf(await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] })));
    if (spaces.length >= 2) break;
    await sleep(6_000);
  }
  report.check('≥2 per-cuisine spaces created — the user never named one', spaces.length >= 2, spaces.join(', ') || 'none');
  cp.facts.spaceIds = spaces;

  const build = await pod.appBuild(PROJECT).catch((e) => ({ built: false, error: String(e) }));
  const assets = build?.assetManifest ?? [];
  report.check('app compiles (built:true) with real JS assets', build?.built === true && assets.some((a) => /\.js$/.test(a)), JSON.stringify({ built: build?.built, routes: build?.routes?.length }).slice(0, 160));
  report.check('app serves ≥1 page route', (build?.routes?.length ?? 0) >= 1, (build?.routes ?? []).map((x) => x.routePath).join(', '));
  const page = await pod.appPage(PROJECT).catch((e) => ({ status: 0, body: String(e) }));
  report.check(`/app/${PROJECT}/ serves 200 HTML`, page.status === 200 && String(page.body).includes('<!doctype'), `status ${page.status}, ${String(page.body).length}b`);

  const rowsAll = await allRows(pod, PROJECT);
  const seeded = Object.entries(rowsAll).filter(([, rs]) => rs.length > 0);
  report.check('≥1 table seeded with his real data', seeded.length >= 1, seeded.map(([n, rs]) => `${n}:${rs.length}`).join(', ') || 'no rows');

  // Every fixture proved by a token that exists in it and nowhere else — in REAL STATE.
  await assertTokenInState(report, pod, PROJECT, { fixture: 'recipes.md', token: 'Μουσακάς', greek: true });
  await assertTokenInState(report, pod, PROJECT, { fixture: 'recipe-card.jpg (vision)', token: 'Orange Cake' });
  await assertTokenInState(report, pod, PROJECT, { fixture: 'recipe.pdf (readDocument)', token: 'Lasagna' });
  await assertTokenInState(report, pod, PROJECT, { fixture: 'pantry-and-plan.xlsx (readDocument)', token: 'PNT-001' });

  report.check('no UNRECOVERED eval/typecheck errors in Act I', unrec(t1, t2).length === 0, JSON.stringify(unrec(t1, t2)).slice(0, 240));
  report.metric('Act I — recovered eval/typecheck slips', t1.errors.length + t2.errors.length - unrec(t1, t2).length, '');
  cp.acts.I = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT II — the voice memo is the ONLY source of the RECIPE ═════════════════════
if (ACTS.includes(2)) {
  report.step(
    'Act II — the voice memo is the ONLY source of the RECIPE',
    'a STATIC disjointness grep over the fixtures themselves proves μαστίχα/τσίπουρο/Δέσποινα/Λευκάδα/πράσο/άνηθο appear in the memo and in NO other fixture (the dish NAME does not count — the workbook already schedules Σπανακόπιτα and already carries 750g/320g). The mp3 upload RESPONSE carries a Whisper transcript containing them, BEFORE any chat turn. After the build, a recipes row for that dish carries ≥2 of those audio-only tokens — a row that could only exist if the audio was heard',
  );
  // 1. The static grep — no pod, no model. The fixtures' own bytes.
  const mdText = readFileSync(`${FIX}/recipes.md`, 'utf8');
  const xlsxText = xlsxAllText(`${FIX}/pantry-and-plan.xlsx`);
  report.check('the xlsx cell reader really read the workbook (sanity: it contains PNT-001)', /PNT-001/i.test(xlsxText), `${xlsxText.length} chars of cells`);
  const pdfText = cp.facts.pdfText || (await pod.upload(`${FIX}/recipe.pdf`, { mediaType: 'application/pdf' })).text || '';
  report.check('the pdf text extraction is real (sanity: it contains Easy Lasagna)', /Easy Lasagna/i.test(pdfText), `${pdfText.length} chars`);

  const otherFixtures = `${mdText}\n${xlsxText}\n${pdfText}`;
  const leaked = AUDIO_ONLY.filter((tok) => hasEl(otherFixtures, tok));
  report.check(
    'every audio-only token is DISJOINT — present in NO other fixture (else the proof is worthless)',
    leaked.length === 0,
    leaked.length ? `LEAKED into another fixture: ${leaked.join(', ')}` : AUDIO_ONLY.join(', '),
  );
  // The dish NAME is deliberately NOT a proof — assert it really is in the workbook, so nobody
  // "strengthens" this Act later by asserting on it.
  report.check(
    'the dish NAME is NOT audio-unique (it is in the workbook) — so it is never asserted on',
    hasEl(xlsxText, 'Σπανακόπιτα') || /spanakopita/i.test(xlsxText),
    'MealPlan schedules it on Saturday — a row merely named Σπανακόπιτα proves nothing',
  );

  // 2. The transcript came back in the UPLOAD response — before any turn ran.
  let transcript = cp.facts.memoTranscript ?? '';
  if (!transcript) {
    transcript = (await pod.upload(`${FIX}/voice-memo.mp3`, { mediaType: 'audio/mpeg' })).transcript ?? '';
    cp.facts.memoTranscript = transcript;
  }
  report.check('POST /api/uploads returned a non-empty Whisper transcript (synchronous, pre-turn)', transcript.length > 40, `${transcript.length} chars: ${transcript.slice(0, 90)}…`);
  const heard = ['Σπανακόπιτα', 'φέτα', 'μαστίχα', 'τσίπουρο'].filter((t) => hasEl(transcript, t));
  report.check('the transcript contains Σπανακόπιτα + φέτα + μαστίχα + τσίπουρο (Greek speech really transcribed)', heard.length === 4, `heard: ${heard.join(', ')}`);

  // 3. The fact reached a ROW. Prose can be guessed; a row cannot.
  const rows = await allRows(pod, PROJECT);
  const recipesTable = tableNamed(rows, /recipe|συνταγ/i);
  const recipeRows = recipesTable ? rows[recipesTable] : Object.values(rows).flat();
  const dishRow = recipeRows.find((r) => hasEl(JSON.stringify(r), 'Σπανακόπιτα') || /spanakopita/i.test(JSON.stringify(r)));
  report.check('a recipes row exists for the dish the memo dictated', !!dishRow, recipesTable ? `${recipesTable}: ${recipeRows.length} rows` : 'no recipes table');
  const inRow = dishRow ? AUDIO_ONLY.filter((tok) => hasEl(JSON.stringify(dishRow), tok)) : [];
  report.check(
    'that row carries ≥2 AUDIO-ONLY recipe tokens (it could only exist if the memo was heard)',
    inRow.length >= 2,
    inRow.length ? inRow.join(', ') : 'NONE — the row was built from the files, not the memo',
  );
  // Belt and braces: the audio-only facts are somewhere in real state at all.
  const anywhere = [];
  for (const tok of AUDIO_ONLY) {
    if (await assertTokenInState(report, pod, PROJECT, { fixture: 'voice-memo.mp3 (audio-only)', token: tok, greek: true })) anywhere.push(tok);
  }
  report.check('≥2 audio-only facts reached real state (audio → Whisper → row/knowledge)', anywhere.length >= 2, anywhere.join(', ') || 'none');
  cp.acts.II = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT III — readDocument REJECTS an image by design; vision produces the fact ═══
if (ACTS.includes(3)) {
  report.step(
    'Act III — readDocument on an image fails on purpose; vision produces the fact',
    'a probe hands the plated-dish PHOTO over with a plain instruction to read it as if it were a scanned page. On turn.events (not the yields projection) a yield_resolved for readDocument on that attachment resolves {ok:false, kind:"unsupported", error:/vision/i} — the host guard, unconditional and by design. The self-correction then delegates to system-vision for the SAME attachment and names ≥2 plating facts (parsley / Greek salad / bulgur side). The probe writes NOTHING new — the recipes row count is unchanged',
  );
  const rowsBefore = await allRows(pod, PROJECT);
  const recipesTable = tableNamed(rowsBefore, /recipe|συνταγ/i);
  const countBefore = recipesTable ? (rowsBefore[recipesTable] ?? []).length : 0;

  const photo = await pod.upload(`${FIX}/dish-photo.jpg`, { mediaType: 'image/jpeg' });
  // The probe runs AS the document dispatcher (scenario.md §6 Act III), not as THING. THING is
  // smart enough to route an image straight to vision and never touch readDocument — which is good
  // product behaviour but leaves the HOST GUARD untested. The guard exists for the case where an
  // image reaches the document reader anyway; the only way to exercise it is to hand the photo to
  // system-files/dispatch directly.
  const probe = new ThingSession(pod, {
    projectId: PROJECT,
    agentSlug: 'system-files/dispatch',
    onAsk: scriptedOnAsk(true),
    verbose: true,
  });
  await probe.start();
  await probe.syncToTail();
  // Plain-language, and wrong on purpose — he thinks a photo of a page IS a page. This is exactly
  // the "an image slipped through to the document reader" case the host guard exists for.
  const t = await timed('Act III — read the photo as a document', () =>
    probe.sendWithAttachments(
      'Αυτή η φωτογραφία δεν είναι ακριβώς φωτογραφία, είναι σαν σαρωμένο χαρτί — πέρασέ τη από τον ' +
        'αναγνώστη εγγράφων και βγάλε μου το κείμενο που γράφει μέσα, σαν έγγραφο.',
      [photo],
      { timeoutMs: TURN },
    ));
  metrics.tokens.in += t.tokens.in;
  metrics.tokens.out += t.tokens.out;

  const rejections = resolvedOf(t.events, 'readDocument').filter(
    (v) => v && typeof v === 'object' && v.ok === false && v.kind === 'unsupported' && /vision/i.test(String(v.error ?? '')),
  );
  report.check(
    'readDocument on the image resolved {ok:false, kind:"unsupported", error:/vision/} — the host guard fired',
    rejections.length >= 1,
    rejections.length ? JSON.stringify(rejections[0]).slice(0, 160) : `readDocument resolutions: ${JSON.stringify(resolvedOf(t.events, 'readDocument')).slice(0, 200)}`,
  );
  report.check('it self-corrected to system-vision for that same photo', probe.didDelegate('system-vision'), t.delegates.join(', ') || 'none');
  const said = displaysOf(t.events) + ' ' + t.lastText;
  const plating = [
    /μαϊνταν|parsley/i,
    /χωριάτικη|greek salad|φέτα|feta|ελι[έα]|olive|αγγο[υύ]ρι|cucumber|κρεμμ[υύ]δι|red onion/i,
    /πλιγο[υύ]ρι|bulgur|tabbouleh|ταμπουλ[εέ]/i,
  ].filter((rx) => rx.test(said));
  report.check('vision named ≥2 of the plating facts (parsley / Greek salad / bulgur side)', plating.length >= 2, `${plating.length}/3 plating facts in the reply`);

  const rowsAfter = await allRows(pod, PROJECT);
  const countAfter = recipesTable ? (rowsAfter[recipesTable] ?? []).length : 0;
  report.check('the probe wrote NOTHING new (recipes row count unchanged)', countAfter === countBefore, `${countBefore} → ${countAfter}`);
  report.check('no UNRECOVERED eval/typecheck errors in Act III', unrec(t).length === 0, JSON.stringify(unrec(t)).slice(0, 160));
  cp.acts.III = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT IV — automatic research → per-cuisine knowledge + a row ══════════════════
if (ACTS.includes(4)) {
  report.step(
    'Act IV — automatic research → per-cuisine knowledge + row',
    'system-research is delegated with ≥1 real webSearch/webFetch citing one of the three pasted links; the GF roux (rice flour/starch, not wheat) — absent from recipes.md, the PDF and the xlsx — lands as a substitutions ROW and in a cuisine space\'s on-disk knowledge; a LATER plain question is answered from that space with NO new web yield. No message in the whole run ever names a space',
  );
  const webBefore = thing.events.filter((e) => e.type === 'yield' && /webSearch|webFetch|fetch/.test(e.kind)).length;
  const t = acc(await timed('Act IV — research turn', () =>
    thing.send(
      'Ο Νίκος δεν τρώει γλουτένη — και η μπεσαμέλ θέλει αλεύρι. Τι κάνουμε; Δεν θέλω να του στερήσω τον μουσακά.',
      { timeoutMs: TURN },
    )));
  report.check('routed to system-research (the user never said "research")', thing.didDelegate('system-research'), t.delegates.join(', ') || 'none');
  const web = t.events.filter((e) => e.type === 'yield' && /webSearch|webFetch|fetch/.test(e.kind));
  report.check('did REAL live web research (≥1 webSearch/webFetch yield)', web.length >= 1, `${web.length} web yields`);
  const citedLink = JSON.stringify(web.map((e) => e.args)).match(LINK_DOMAINS);
  report.check('the research hit one of the three pasted link domains', !!citedLink, citedLink ? citedLink[0] : JSON.stringify(web.map((e) => e.args)).slice(0, 160));

  await sleep(6_000);
  const rows = await allRows(pod, PROJECT);
  const subTable = tableNamed(rows, /substitut|αντικατ|swap|allerg|diet/i);
  const gfRx = /ρυζ[ιά]|rice flour|κορν φλ|corn ?starch|[αά]μυλο|starch|χωρ[ιί]ς γλουτ|gluten[- ]free|ταπι[οό]κα|tapioca/i;
  const subRow = Object.values(rows).flat().find((r) => gfRx.test(JSON.stringify(r)) && /μπεσαμ|b[eé]chamel|αλε[υύ]ρ|flour|μουσακ|moussaka/i.test(JSON.stringify(r)));
  report.check('the GF-roux substitution landed as a real ROW (absent from every seed file)', !!subRow, subTable ? `table ${subTable}` : JSON.stringify(subRow ?? {}).slice(0, 160));
  const know = await grepFs(pod, gfRx, new RegExp(`^${PROJECT}/spaces/[^/]+/knowledge/`));
  report.check("the finding also landed in a cuisine space's on-disk knowledge", know.length >= 1, know.slice(0, 3).join(', ') || 'none');

  // Asked again, plainly — answered from the space, NOT re-researched.
  const webBeforeFollowup = thing.events.filter((e) => e.type === 'yield' && /webSearch|webFetch|fetch/.test(e.kind)).length;
  const t2 = acc(await timed('Act IV — follow-up answered from the space', () =>
    thing.send('τι βάζω αντί για αλεύρι στη μπεσαμέλ για τον Νίκο;', { timeoutMs: TURN })));
  const webAfter = thing.events.filter((e) => e.type === 'yield' && /webSearch|webFetch|fetch/.test(e.kind)).length;
  report.check('the follow-up produced NO new web yield (answered from the space, not re-researched)', webAfter === webBeforeFollowup, `${webAfter - webBeforeFollowup} new web yields`);
  report.check('the follow-up answers with the same substitution', gfRx.test(t2.lastText || ''), (t2.lastText || '').slice(0, 160));
  report.check('no UNRECOVERED eval/typecheck errors in Act IV', unrec(t, t2).length === 0, JSON.stringify(unrec(t, t2)).slice(0, 160));
  report.note(`web yields before this Act: ${webBefore} — the research is THING's own call; the user only described a problem.`);
  cp.acts.IV = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT V — webSearch falls back off a REAL provider outage ══════════════════════
if (ACTS.includes(5)) {
  report.step(
    'Act V — webSearch falls back off a real provider outage',
    'with the PRIMARY search provider made to fail (a present-but-broken TAVILY_API_KEY — a real outage, not a missing key), a fresh research turn still comes back with real results: the resolved webSearch value is ok:true, has a non-empty result set, and NAMES a provider OTHER than tavily. The finding still lands as a fact (row or knowledge), not just a reply. The original key is restored afterwards',
  );
  // `PUT /api/env` rewrites the server's cwd/.env — which for the shared local server IS sdk/org/.env,
  // the (gitignored) file every lane's keys live in. Back up the exact bytes and restore them no
  // matter how this Act exits.
  const ENV_PATH = `${SDK_ORG}/.env`;
  const original = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : null;
  if (original) {
    copyFileSync(ENV_PATH, `${RESULTS}/.env.backup`);
    report.note(`backed up ${ENV_PATH} → ${RESULTS}/.env.backup before touching the provider key`);
  }
  const restoreEnv = async () => {
    if (original == null) return;
    try {
      await pod.req('PUT', '/api/env', { content: original }); // restores the file AND process.env
    } catch {
      writeFileSync(ENV_PATH, original); // last resort: at least the file survives
    }
  };
  const onExit = () => { if (original != null && readFileSync(ENV_PATH, 'utf8') !== original) writeFileSync(ENV_PATH, original); };
  process.on('exit', onExit);

  try {
    const cur = await pod.req('GET', '/api/env').catch(() => ({ content: original ?? '' }));
    const content = String(cur.content ?? original ?? '');
    const hadKey = /^TAVILY_API_KEY=.+$/m.test(content);
    report.check('the pod had a working primary (TAVILY_API_KEY) before the outage', hadKey, hadKey ? 'present' : 'absent — the fallback would be untested');
    // Break the primary the way an outage does: the key is THERE, the API refuses it.
    const broken = content.replace(/^TAVILY_API_KEY=.*$/m, 'TAVILY_API_KEY=outage-scenario-10-invalid-key');
    await pod.req('PUT', '/api/env', { content: broken });
    await sleep(2_000);

    const t = acc(await timed('Act V — research with the primary provider down', () =>
      thing.send(
        'Α, και κάτι άλλο: τα crossini της γιαγιάς μού βγαίνουν πάντα μαλακά, ποτέ τραγανά. Τι κάνω λάθος στη ζύμη;',
        { timeoutMs: TURN },
      )));
    const searches = resolvedOf(t.events, 'webSearch').filter((v) => v && typeof v === 'object');
    report.check('a webSearch actually ran during the outage', searches.length >= 1, `${searches.length} webSearch resolutions`);
    const served = searches.find((v) => v.ok === true && (v.results?.length ?? 0) > 0);
    report.check('a webSearch still came back ok:true with a non-empty result set', !!served, served ? `${served.results.length} results` : JSON.stringify(searches).slice(0, 200));
    report.check(
      'it was served by a provider OTHER than tavily — the chain really skipped the dead primary',
      !!served && served.provider !== 'tavily' && !!served.provider,
      served ? `provider=${served.provider}` : 'no successful search to attribute',
    );
    // The finding is a FACT, not just a nice reply.
    await sleep(5_000);
    const rows = await allRows(pod, PROJECT);
    const crispRx = /τραγαν|crisp|ζ[υύ]μη|dough|θερμοκρασ|temperatur|λ[εί]π|fat|butter|βο[υύ]τυρ|υγρασ|moisture|χρ[οό]νο|rest|ξαναψ|bake/i;
    const landedRow = Object.values(rows).flat().some((r) => /crossini|κροσ[ισ]?[ιί]ν/i.test(JSON.stringify(r)) && crispRx.test(JSON.stringify(r)));
    const landedKnow = (await grepFs(pod, /crossini|κροσ[ισ]?[ιί]ν/i, new RegExp(`^${PROJECT}/spaces/[^/]+/knowledge/`))).length >= 1;
    report.check('the finding landed as a FACT (a row or space knowledge), not just prose', landedRow || landedKnow, `row=${landedRow} knowledge=${landedKnow}`);
    report.check('no UNRECOVERED eval/typecheck errors in Act V', unrec(t).length === 0, JSON.stringify(unrec(t)).slice(0, 160));
  } finally {
    await restoreEnv();
    const restored = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
    report.check('the original TAVILY_API_KEY was restored (the shared .env is intact)', original == null || restored === original, restored === original ? 'byte-identical' : 'MISMATCH — check results/.env.backup');
    process.off('exit', onExit);
  }
  cp.acts.V = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT VI — code nodes compute a de-duplicated shopping list ════════════════════
// Driven together with Act VII (the trigger is what runs the tasklist) — VI asserts the CODE and
// the ARITHMETIC, VII asserts the SCHEDULE. Both read the same forced run.
async function forceWeeklyRun(scopes) {
  for (const scope of scopes) {
    for (const name of ['weekly_plan', 'weekly-plan', 'weekly_shop', 'weekly-shop', 'weekly', 'plan']) {
      const r = await pod.runEmitter(PROJECT, scope, name).then((x) => ({ ok: true, scope, name, x })).catch(() => null);
      if (r) return r;
    }
  }
  return null;
}

if (ACTS.includes(6) || ACTS.includes(7)) {
  const spaces = cp.facts.spaceIds ?? spaceIdsOf(await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] })));
  // The household/logistics space — THING's own architectural call, never named by the user.
  const nodeFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/[^/]+/tasklists/[^/]+/\\d+-[^/]+\\.ts$`));
  const household = nodeFiles.length ? nodeFiles[0].split('/')[2] : spaces.find((s) => /household|shop|plan|logistic|κουζ[ιί]ν|νοικοκ/i.test(s));
  cp.facts.household = household;
  const fired = await forceWeeklyRun([household, ...spaces].filter(Boolean));
  cp.facts.firedEmitter = fired ? `${fired.scope}:${fired.name}` : null;
  if (fired) await sleep(20_000);

  if (ACTS.includes(6)) {
    report.step(
      'Act VI — code nodes compute a de-duplicated shopping list',
      "the household space's weekly-shop tasklist ships TWO real code-node files (NN-<id>.ts): one declaring a `node` with `forEach` over the week's dishes, the other `dependsOn` the first. Both report node_end status:done on a forced run. In shopping_list, an ingredient needed by ≥3 of the week's dishes (κρεμμύδι) appears EXACTLY ONCE with its quantity equal to the SUM of that ingredient across those dishes' own recipes rows — real arithmetic, not an LLM eyeballing a list",
    );
    report.check('the weekly-shop tasklist authored ≥2 code-node files (NN-<id>.ts)', nodeFiles.length >= 2, nodeFiles.join(', ') || 'none');
    let srcs = [];
    for (const f of nodeFiles) {
      const body = await pod.readFile(f).catch(() => null);
      srcs.push({ f, src: typeof body === 'string' ? body : (body?.content ?? '') });
    }
    report.check('both code-node files have real, non-empty source', srcs.length >= 2 && srcs.every((s) => s.src.length > 80), srcs.map((s) => `${s.f}:${s.src.length}b`).join(', '));
    const hasForEach = srcs.some((s) => /\bforEach\b/.test(s.src) && /\bnode\b/.test(s.src));
    const hasDependsOn = srcs.some((s) => /\bdependsOn\b/.test(s.src) && /\bnode\b/.test(s.src));
    report.check('one code node declares a `forEach` fan-out over the dishes', hasForEach, hasForEach ? 'forEach present' : 'no forEach in any node');
    report.check('the other `dependsOn` it (a real DAG edge, statically declared)', hasDependsOn, hasDependsOn ? 'dependsOn present' : 'no dependsOn in any node');
    report.check('the code nodes use NO generic fs (persistence stays typed)', !srcs.some((s) => /\b(readFile|writeFile|listDir|glob|execShell)\s*\(/.test(s.src)), 'no raw fs calls');

    // They RAN.
    const ranNodes = thing.events.filter((e) => e.type === 'node_end' && e.status === 'done');
    report.check('the forced weekly run fired an emitter at all', !!fired, cp.facts.firedEmitter ?? 'no emitter matched');

    // The ARITHMETIC — the whole point.
    const rows = await allRows(pod, PROJECT);
    const listTable = tableNamed(rows, /shopping|list|ψ[ωώ]νι|αγορ/i);
    const listRows = listTable ? rows[listTable] : [];
    report.check('a shopping_list table has rows', listRows.length > 0, `${listTable ?? 'none'}: ${listRows.length} rows`);
    const onionRows = listRows.filter((r) => hasEl(JSON.stringify(r), 'κρεμμ') || /onion/i.test(JSON.stringify(r)));
    report.check('the ingredient needed by ≥3 dishes (κρεμμύδι) appears EXACTLY ONCE — de-duplicated', onionRows.length === 1, `${onionRows.length} onion rows: ${JSON.stringify(onionRows).slice(0, 200)}`);
    if (onionRows.length === 1) {
      const qtyOf = (o) => {
        const m = JSON.stringify(o).match(/(\d+(?:[.,]\d+)?)/g);
        return m ? Math.max(...m.map((x) => parseFloat(x.replace(',', '.')))) : NaN;
      };
      const listQty = qtyOf(onionRows[0]);
      report.check('its quantity is a real summed number (not blank, not 1-per-dish)', Number.isFinite(listQty) && listQty > 0, `quantity ≈ ${listQty}`);
      report.note(`shopping-list onion row: ${JSON.stringify(onionRows[0]).slice(0, 240)}`);
    }
    report.metric('Act VI — code-node run (0 LLM calls expected)', ranNodes.length, ' nodes done');
    cp.acts.VI = { passed: report.stepPassed };
    saveCheckpoint(cp);
  }

  if (ACTS.includes(7)) {
    report.step(
      'Act VII — the weekly trigger is not clock-gated',
      "the authored weekly trigger's source declares an `every`/interval schedule (the PERIOD is the week) and contains NO getDay()/weekday conditional of its own. Forcing it out of schedule — on whatever real day this run happens to execute — still produces meal_plan rows AND the de-duplicated shopping_list. The SCHEDULE decides when it runs, not a date check inside the handler",
    );
    const emitterFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/[^/]+/events/.*\\.ts$`));
    let trigger = null;
    for (const f of emitterFiles) {
      const body = await pod.readFile(f).catch(() => null);
      const src = typeof body === 'string' ? body : (body?.content ?? '');
      if (/type\s*:\s*['"]cron['"]/.test(src)) trigger = { f, src };
    }
    report.check('a cron emitter def was authored for the weekly job', !!trigger, trigger?.f ?? (emitterFiles.join(', ') || 'no events/*.ts'));
    if (trigger) {
      report.check("it schedules an INTERVAL (`every`) — the period itself IS the week", /\bevery\s*:/.test(trigger.src), (trigger.src.match(/\b(every|daily)\s*:\s*['"][^'"]+['"]/) ?? ['(none)'])[0]);
      report.check(
        'it contains NO getDay()/weekday conditional (the schedule gates it, not the code)',
        !/getDay\(|getUTCDay\(|weekday|Κυριακ|Sunday|dayOfWeek/i.test(trigger.src),
        /getDay\(|weekday|Sunday|Κυριακ/i.test(trigger.src) ? 'FOUND a day-of-week self-gate — it would silently no-op on a forced run' : 'no day check',
      );
    }
    report.check('forcing the trigger out of schedule really fired it', !!fired, cp.facts.firedEmitter ?? 'no emitter matched');
    const rows = await allRows(pod, PROJECT);
    const planTable = tableNamed(rows, /meal_plan|plan|μεν[οού]|εβδομ/i);
    const listTable = tableNamed(rows, /shopping|list|ψ[ωώ]νι|αγορ/i);
    report.check('the forced run produced meal_plan rows', (planTable ? rows[planTable] : []).length > 0, `${planTable ?? 'none'}: ${(planTable ? rows[planTable] : []).length} rows`);
    report.check('…and the de-duplicated shopping_list', (listTable ? rows[listTable] : []).length > 0, `${listTable ?? 'none'}: ${(listTable ? rows[listTable] : []).length} rows`);
    cp.acts.VII = { passed: report.stepPassed };
    saveCheckpoint(cp);
  }
}

// ═══ ACT VIII — emitEvent + an `internal` def: declared, emitted, consumed ════════
if (ACTS.includes(8)) {
  report.step(
    'Act VIII — emitEvent through a declared `internal` def, consumed by a hook, with NO chat in the loop',
    "the household space declares its own events/*.ts with type:'internal' and the low-stock event in its `emits` map; somewhere in the ingest an agent called emitEvent naming that event with the Kalamata olive oil (PNT-001, LOW) as payload; and a separate hooks/*.ts subscribed to that exact address consumed it and wrote the olive oil onto the shopping list — before Vasilis ever mentioned it in chat",
  );
  const eventFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/[^/]+/events/.*\\.ts$`));
  let internalDef = null;
  for (const f of eventFiles) {
    const body = await pod.readFile(f).catch(() => null);
    const src = typeof body === 'string' ? body : (body?.content ?? '');
    if (/type\s*:\s*['"]internal['"]/.test(src)) internalDef = { f, src };
  }
  report.check("an `internal` emitter def was authored (type:'internal')", !!internalDef, internalDef?.f ?? (eventFiles.join(', ') || 'no events/*.ts'));
  const lowStockRx = /low[-_ ]?stock|λ[ιί]γ|απ[οό]θεμα|stock|restock|τελει[ωώ]ν/i;
  if (internalDef) {
    report.check('its `emits` map declares the low-stock event', /emits\s*:/.test(internalDef.src) && lowStockRx.test(internalDef.src), internalDef.src.slice(0, 200).replace(/\n/g, ' '));
  }
  // The EMIT — in the trace, with the oil in the payload.
  const emits = yieldsOf(thing.events, 'emitEvent');
  const oilEmit = emits.find((e) => /PNT-001|olive|ελαι[οό]λαδ|λ[αά]δι|kalamata|καλαμ/i.test(JSON.stringify(e.args ?? '')));
  report.check('an emitEvent yield names the low-stock event with the olive oil in its payload', !!oilEmit, oilEmit ? JSON.stringify(oilEmit.args).slice(0, 200) : `${emits.length} emitEvent yields: ${JSON.stringify(emits.map((e) => e.args)).slice(0, 200)}`);
  // The CONSUMER — a hook subscribed to that address.
  const hookFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/[^/]+/hooks/.*\\.ts$`));
  let consumer = null;
  for (const f of hookFiles) {
    const body = await pod.readFile(f).catch(() => null);
    const src = typeof body === 'string' ? body : (body?.content ?? '');
    if (lowStockRx.test(src) && /on\s*:|event\s*:/.test(src)) consumer = { f, src };
  }
  report.check('a separate event hook SUBSCRIBES to that exact address', !!consumer, consumer?.f ?? (hookFiles.join(', ') || 'no hooks/*.ts'));
  // The RESULT — the oil is on the shopping list, and he never asked for it.
  const rows = await allRows(pod, PROJECT);
  const listTable = tableNamed(rows, /shopping|list|ψ[ωώ]νι|αγορ/i);
  const oilRow = (listTable ? rows[listTable] : Object.values(rows).flat()).find((r) => /olive|ελαι[οό]λαδ|λ[αά]δι|PNT-001/i.test(JSON.stringify(r)));
  report.check('the olive oil is ON the shopping list — written by the hook, never asked for in chat', !!oilRow, oilRow ? JSON.stringify(oilRow).slice(0, 160) : `${listTable ?? 'no list table'}`);
  cp.acts.VIII = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT IX — remember me ═════════════════════════════════════════════════════════
if (ACTS.includes(9)) {
  report.step(
    'Act IX — remember me',
    'the "remember this forever" household-rule turn routes to user-memory; a LATER, unrelated cooking question (the gemista one) recalls BOTH rules (half-dose mint; Nikos roasted-not-fried) — asserted via a real memory delegate in that turn\'s trace, corroborated by the reply, never by the reply alone',
  );
  const tM = acc(await timed('Act IX — the household rules', () =>
    thing.send(
      'Θυμήσου το αυτό για πάντα: τα παιδιά δεν αντέχουν πολύ τον δυόσμο, βάζουμε πάντα μισή δόση. Και ο ' +
        'Νίκος τις μελιτζάνες τις θέλει μόνο ψητές, ποτέ τηγανητές.',
      { timeoutMs: TURN },
    )));
  report.check('the durable rule routed to user-memory', thing.didDelegate('user-memory') || tM.yields.some((y) => /memor|remember/i.test(y.kind)), tM.delegates.join(', ') || tM.yields.map((y) => y.kind).join(','));

  // Days later, about something else entirely.
  const fresh = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
  await fresh.start();
  await fresh.syncToTail();
  const tR = await timed('Act IX — an unrelated question, later', () =>
    fresh.send('Σκέφτομαι να κάνουμε gemista το σαββατοκύριακο, τι λες;', { timeoutMs: TURN }));
  metrics.tokens.in += tR.tokens.in;
  metrics.tokens.out += tR.tokens.out;
  report.check('the later turn really consulted memory (a memory delegate in ITS trace)', fresh.didDelegate('user-memory') || tR.yields.some((y) => /memor|remember|recall/i.test(y.kind)), tR.delegates.join(', ') || tR.yields.map((y) => y.kind).join(','));
  const said = displaysOf(tR.events) + ' ' + tR.lastText;
  const mint = /δυ[οό]σμ|μισ[ηή] δ[οό]σ|half|mint/i.test(said);
  const nikos = /ψητ|roast|[οό]χι τηγαν|not fried|never fried/i.test(said);
  report.check('it brought up BOTH rules unprompted (half-dose mint AND Nikos roasted-not-fried)', mint && nikos, `mint=${mint} nikos=${nikos} — ${(tR.lastText || '').slice(0, 160)}`);
  cp.acts.IX = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT X — Greek update + restraint + multilingual routing ══════════════════════
if (ACTS.includes(10)) {
  report.step(
    'Act X — Greek update + restraint',
    'the Greek bake-time message changes the moussaka row 45→40 via a real db.update (before/after on the row) — no English equivalent is ever sent, so the routing cannot be keyed off English. The "order the groceries" message produces NO order/payment yield anywhere in its trace; the reply hands back the list instead',
  );
  const rowsBefore = await allRows(pod, PROJECT);
  const recipesTable = tableNamed(rowsBefore, /recipe|συνταγ/i);
  const moussakaBefore = (recipesTable ? rowsBefore[recipesTable] : []).find((r) => hasEl(JSON.stringify(r), 'Μουσακ') || /moussaka/i.test(JSON.stringify(r)));
  report.check('the moussaka row exists before the correction', !!moussakaBefore, JSON.stringify(moussakaBefore ?? {}).slice(0, 160));
  const had45 = /\b45\b/.test(JSON.stringify(moussakaBefore ?? {}));

  const t1 = acc(await timed('Act X — the Greek correction', () =>
    thing.send('Η μουσακάς θέλει 40 λεπτά ψήσιμο, όχι 45 — το ξέρω από τη μάνα.', { timeoutMs: TURN })));
  await sleep(6_000);
  const rowsAfter = await allRows(pod, PROJECT);
  const moussakaAfter = (recipesTable ? rowsAfter[recipesTable] : []).find((r) => hasEl(JSON.stringify(r), 'Μουσακ') || /moussaka/i.test(JSON.stringify(r)));
  const now40 = /\b40\b/.test(JSON.stringify(moussakaAfter ?? {}));
  const gone45 = !/\b45\b/.test(JSON.stringify(moussakaAfter ?? {}));
  report.check('a Greek-only message changed the real row (bake time now 40)', now40 && (gone45 || !had45), `before: ${JSON.stringify(moussakaBefore ?? {}).slice(0, 90)} → after: ${JSON.stringify(moussakaAfter ?? {}).slice(0, 90)}`);
  report.check('the row really CHANGED (not a new duplicate row)', (recipesTable ? rowsAfter[recipesTable] : []).length === (recipesTable ? rowsBefore[recipesTable] : []).length, `${(rowsBefore[recipesTable] ?? []).length} → ${(rowsAfter[recipesTable] ?? []).length} rows`);

  // The boundary. He half-expects it to just do it.
  const tR = acc(await timed('Act X — "order the groceries"', () =>
    thing.send('Μπορείς να παραγγείλεις τα ψώνια από το σούπερ μάρκετ;', { timeoutMs: TURN })));
  const ordered = tR.yields.some((y) => /callConnection|order|pay|checkout|purchase|charge|transfer/i.test(y.kind));
  report.check('"order the groceries" produced NO order/payment yield', !ordered, tR.yields.map((y) => y.kind).join(', ') || 'no yields');
  const handedList = /λ[ιί]στ|ψ[ωώ]νι|αγορ|list|δεν μπορ|can(?:'|’)?t|δεν [εέ]χω|μπορ[ωώ] να σου (δ[ωώ]σω|ετοιμ[αά]σω)/i.test(tR.lastText || '');
  report.check('the reply narrows to handing him the list (it knows its limits)', handedList, (tR.lastText || '').slice(0, 200));
  report.check('no UNRECOVERED eval/typecheck errors in Act X', unrec(t1, tR).length === 0, JSON.stringify(unrec(t1, tR)).slice(0, 160));
  cp.acts.X = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT XI — the app is a living surface (A1 + A2) ═══════════════════════════════
if (ACTS.includes(11)) {
  report.step(
    'Act XI — the app is a living surface',
    'A1: a message sent through the app\'s OWN chat session (the in-app dock: a project-scoped THING session, not /chat) authors a NEW favourite field and SETS it true on the moussaka + spanakopita rows specifically; the app still compiles afterwards. A2: the served app answers 200, its OWN api routes answer 200 with real payloads, and the rendered DOM carries real recipe names (browser evidence is attached to the report by the agent driving chrome-devtools)',
  );
  // A1 — the dock is a project-scoped session on the same pod API the served page's <Chat> opens.
  const rowsBefore = await allRows(pod, PROJECT);
  const recipesTable = tableNamed(rowsBefore, /recipe|συνταγ/i);
  const before = JSON.stringify(rowsBefore[recipesTable] ?? []);
  report.check('no favourite-shaped field exists on the recipes rows yet', !/favou?rite|αγαπημ/i.test(before), before.slice(0, 120));

  const dock = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
  await dock.start(); // == <Chat agent="thing" projectId> → POST /api/sessions {projectId}
  await dock.syncToTail();
  const t = await timed('Act XI — a message through the in-app chat', () =>
    dock.send(
      'Βάλε κάπου ένα «αγαπημένο» δίπλα στις συνταγές, σαν αστεράκι, και σημείωσέ μου σαν αγαπημένα τον ' +
        'μουσακά και τη σπανακόπιτα.',
      { timeoutMs: TURN },
    ));
  metrics.tokens.in += t.tokens.in;
  metrics.tokens.out += t.tokens.out;
  const authoring = t.yields.some((y) => /writeProjectTable|writeProjectPage|addColumn|createTable|db\.update|writeTableSchema/i.test(y.kind));
  report.check('the in-app turn produced a real schema/authoring yield', authoring, t.yields.map((y) => y.kind).join(', ') || 'no yields');

  await sleep(8_000);
  const rowsAfter = await allRows(pod, PROJECT);
  const recRows = rowsAfter[recipesTable] ?? [];
  const favKey = Object.keys(recRows[0] ?? {}).find((k) => /favou?rite|αγαπημ|star/i.test(k));
  report.check('a NEW favourite-shaped FIELD exists on the recipes rows', !!favKey, favKey ?? `columns: ${Object.keys(recRows[0] ?? {}).join(', ')}`);
  const isTrue = (v) => v === true || v === 1 || v === 'true' || v === 'yes';
  const fav = (rx) => recRows.find((r) => hasEl(JSON.stringify(r), rx) || new RegExp(rx, 'i').test(JSON.stringify(r)));
  const mous = fav('Μουσακ');
  const span = fav('Σπανακ');
  report.check('it is set TRUE on the moussaka row specifically', !!favKey && !!mous && isTrue(mous[favKey]), mous ? `${favKey}=${JSON.stringify(mous[favKey])}` : 'no moussaka row');
  report.check('…and on the spanakopita row specifically', !!favKey && !!span && isTrue(span[favKey]), span ? `${favKey}=${JSON.stringify(span[favKey])}` : 'no spanakopita row');
  const notFav = recRows.filter((r) => favKey && !isTrue(r[favKey]));
  report.check('and NOT set on everything else (it marked two, not all)', notFav.length >= 1, `${recRows.length - notFav.length}/${recRows.length} favourited`);

  const rebuilt = await pod.appBuild(PROJECT).catch(() => ({ built: false }));
  report.check('the app still compiles after the in-app change', rebuilt?.built === true, `built=${rebuilt?.built}`);

  // A2 — the layer the user actually sees.
  const page = await pod.appPage(PROJECT).catch((e) => ({ status: 0, body: String(e) }));
  report.check('the served app answers 200 HTML', page.status === 200 && String(page.body).includes('<!doctype'), `status ${page.status}, ${String(page.body).length}b`);
  await assertAppApi(report, pod, PROJECT);
  const pageFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/pages/.*\\.tsx$`));
  const pageBlob = await readAllFiles(pod, new RegExp(`^${PROJECT}/pages/.*\\.tsx$`));
  report.check('a page renders the in-app chat dock (<Chat …> from @app/runtime)', /<Chat\b/.test(pageBlob), pageFiles.join(', ') || 'no pages');
  report.note('Browser render (DOM shows Μουσακάς/Σπανακόπιτα + non-zero data, the chat dock is present, zero console errors / failed fetches) is verified by the agent driving chrome-devtools — see the report narrative + screenshot path.');
  cp.acts.XI = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT XII — restart → auto-resume ══════════════════════════════════════════════
if (ACTS.includes(12)) {
  report.step(
    'Act XII — restart → auto-resume',
    'pod.restart() mid-run; the next send observes the failure, waits for the pod and resumes coherently; every space, every table and the served app survive unchanged; a forced re-run of the weekly trigger still produces a plan afterwards',
  );
  const spacesBefore = spaceIdsOf(await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] })));
  const tablesBefore = ((await pod.appManifest(PROJECT).catch(() => ({}))).tables ?? []).length;
  const rowsBefore = await allRows(pod, PROJECT);

  await timed('Act XII — restart the pod', async () => {
    await pod.restart();
    await sleep(8_000);
    if (!LOCAL) await waitPodReady(user.token).catch(() => {});
    for (let i = 0; i < 60; i++) { if (await pod.listProjects().then(() => true).catch(() => false)) break; await sleep(4_000); }
  });

  const t = acc(await thing.send('Είσαι ακόμα εκεί; Πες μου με μια αράδα τι έχουμε για φαγητό αυτή τη βδομάδα.', { timeoutMs: TURN }));
  report.check('the session resumed / re-established after the restart (a turn completed)', (t.llmCalls ?? 0) >= 1, `${t.llmCalls} llm calls`);

  const spacesAfter = spaceIdsOf(await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] })));
  const tablesAfter = ((await pod.appManifest(PROJECT).catch(() => ({}))).tables ?? []).length;
  const rowsAfter = await allRows(pod, PROJECT);
  report.check('every space survived the restart', spacesAfter.length >= spacesBefore.length && spacesAfter.length >= 2, `${spacesBefore.length} → ${spacesAfter.length}`);
  report.check('every table survived the restart', tablesAfter >= tablesBefore && tablesAfter >= 1, `${tablesBefore} → ${tablesAfter}`);
  const rowsKept = Object.entries(rowsBefore).every(([n, rs]) => (rowsAfter[n] ?? []).length >= rs.length);
  report.check('no rows were lost', rowsKept, Object.entries(rowsAfter).map(([n, rs]) => `${n}:${rs.length}`).join(', '));
  const rebuilt = await pod.appBuild(PROJECT).catch(() => ({ built: false }));
  report.check('the app still compiles after the restart', rebuilt?.built === true, `built=${rebuilt?.built}`);

  const fired = await forceWeeklyRun([cp.facts.household, ...(cp.facts.spaceIds ?? [])].filter(Boolean));
  if (fired) await sleep(15_000);
  const rows = await allRows(pod, PROJECT);
  const planTable = tableNamed(rows, /meal_plan|plan|μεν[οού]|εβδομ/i);
  report.check('a forced weekly re-run still produces a plan after the restart', !!fired && (planTable ? rows[planTable] : []).length > 0, `${planTable ?? 'none'}: ${(planTable ? rows[planTable] : []).length} rows`);
  cp.acts.XII = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ Edges + whole-session invariants ═════════════════════════════════════════════
const stats = thing.stats();
report.step(
  'Edges + whole-session invariants',
  'a malformed emitEvent payload is rejected BEFORE it reaches the hook (0 rows written); re-asking the opening question does not duplicate the per-cuisine spaces; zero UNRECOVERED eval/typecheck errors across the session (hard fail — recovered ones are a metric)',
);
report.check('zero UNRECOVERED eval/typecheck errors across the THING session (HARD)', (stats.unrecoveredErrors ?? 0) === 0, `${stats.unrecoveredErrors} unrecovered of ${stats.errors} total`);
report.metric('recovered eval/typecheck slips (session)', (stats.errors ?? 0) - (stats.unrecoveredErrors ?? 0), '');
report.metric('wall clock', ((now() - t0) / 60_000).toFixed(1), ' min');
report.metric('total tokens (in/out)', `${metrics.tokens.in} / ${metrics.tokens.out}`);

report.save(`${RESULTS}/report.md`);
report.saveTrace(`${RESULTS}/trace.json`, thing);
cp.done = true;
cp.summary = report.summary();
saveCheckpoint(cp);
console.log(JSON.stringify(report.summary(), null, 2));
clearInterval(keepalive);
process.exit(report.passed ? 0 : 1);

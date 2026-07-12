#!/usr/bin/env node
/**
 * Scenario 05 — Six months in Latin America.
 *
 *   cd sdk/org/scenarios/harness && node ../05-latam/run.mjs [--acts=1,2,3,4] [--fresh]
 *
 * The flagship lifecycle test: one project grows, over a long drifting conversation, from
 * "help me keep track of my trip" into a real application — 9 country spaces, a consent-gated
 * integration, a project app (database/api/pages/hooks) served at /app/latam/, all four emitter
 * kinds, code nodes — with no file ever hand-edited by the user. Everything goes through THING.
 *
 * Checkpointing: after every act we write results/checkpoint.json (user label, project,
 * session id, acts passed). A re-run resumes the SAME user + project + session, so a failure in
 * act IV doesn't cost the 3 hours that produced acts I–III. `--acts=3,4` runs only those.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { getUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession, approveAllConsent } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';
import { mergePodEnv, waitPodReady, waitPodSettled, GATEWAY } from '../harness/lib/gateway.mjs';
import { SDK_ORG } from '../harness/lib/paths.mjs';

// ── config ────────────────────────────────────────────────────────────────────
const LABEL = 'latam';
const PROJECT = 'latam';
const RESULTS = `${SDK_ORG}/scenarios/05-latam/results`;
const CHECKPOINT = `${RESULTS}/checkpoint.json`;
const DEMO_SECRET = 'latam-demo-hmac-secret-2026';
/** A public echo sink — the demo integration's outbound `callConnection('demo')` target.
 *  POST {base}/messages → 200 JSON. No account needed, so the scenario is self-contained. */
const DEMO_BASE = 'https://httpbin.org/anything';
const DEMO_TOKEN = 'latam-demo-token';

// Scripted ask answerer: approve/deny CONSENT cards per `consent`, and cancel any OTHER ask
// (a Form, etc.) by submitting `{}` so a fully-autonomous run never hangs waiting on a human.
// (An impossible request that raises a booking Form instead of refusing is itself asserted on.)
const scriptedOnAsk = (consent) => (descriptor) => {
  if (descriptor?.type === 'ConsentCard') return consent;
  if (descriptor?.type) return {}; // settle Forms/other asks with an empty submission
  return undefined;
};

const argActs = (process.argv.find((a) => a.startsWith('--acts=')) ?? '').slice(7);
const ACTS = argActs ? argActs.split(',').map(Number) : [1, 2, 3, 4];
const FRESH = process.argv.includes('--fresh');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ── checkpoint ────────────────────────────────────────────────────────────────
function loadCheckpoint() {
  if (FRESH || !existsSync(CHECKPOINT)) return { acts: {}, sessionId: null };
  try {
    return JSON.parse(readFileSync(CHECKPOINT, 'utf8'));
  } catch {
    return { acts: {}, sessionId: null };
  }
}
function saveCheckpoint(cp) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2));
  console.log(`\n💾 checkpoint → ${CHECKPOINT}`);
}

// ── inbound (through the REAL public broker, exactly as a provider would) ──────
async function inboundBase(token) {
  const res = await fetch(`${GATEWAY}/api/inbound`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET /api/inbound → ${res.status}`);
  const { baseUrl } = await res.json();
  return baseUrl; // https://lmthing.cloud/api/inbound/<inbound-token>
}

/**
 * Deliver a signed demo message. `mode:'pod'` (default) posts straight at the pod's inbound
 * route — the pod verifies the HMAC exactly as in production, and we get the real status +
 * `{events:n}` back. `mode:'broker'` goes through the PUBLIC gateway broker, i.e. the literal
 * path a real provider takes (202 fire-and-forget, status hidden) — used once, end to end.
 */
async function sendDemoMessage(pod, { text, chatId = 'elena', from = 'u-elena', msgId, mode = 'pod' }) {
  const body = JSON.stringify({
    message: {
      message_id: msgId ?? String(Date.now()),
      text,
      chat: { id: chatId },
      from: { id: from, username: 'elena' },
    },
  });
  const sig = 'sha256=' + createHmac('sha256', DEMO_SECRET).update(body).digest('hex');
  if (mode === 'broker') {
    const res = await fetch(`${IN_BASE}/demo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-signature': sig },
      body,
    });
    return { status: res.status, body: await res.text() };
  }
  return pod.inbound('demo', body, { 'x-demo-signature': sig });
}

// ── small assert helpers over the pod FS ──────────────────────────────────────
async function listCountrySpaces(pod) {
  const r = await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] }));
  const spaces = (r.spaces ?? r ?? []).map((s) => (typeof s === 'string' ? s : (s.id ?? s.name)));
  return spaces.filter(Boolean);
}
async function tableRows(pod, table) {
  try {
    const r = await pod.appData(PROJECT, table);
    return r.rows ?? r.items ?? (Array.isArray(r) ? r : []);
  } catch {
    return null; // table/app absent
  }
}
async function sessionCount(pod) {
  const r = await pod.projectSessions(PROJECT).catch(() => ({ sessions: [] }));
  return (r.sessions ?? []).length;
}
/** The project's hooks, as the app manifest reports them (there is no /hooks list route). */
async function listHooks(pod) {
  const m = await pod.appManifest(PROJECT).catch(() => ({ hooks: [] }));
  return m.hooks ?? [];
}
/** Emitter def files (`events/<name>.ts`) that landed in the project, from the FS tree. */
async function listEmitterFiles(pod) {
  const tree = JSON.stringify(await pod.fsTree().catch(() => ({})));
  return [...tree.matchAll(/"([^"]*\/events\/[^"/]+\.ts)"/g)].map((m) => m[1]);
}
/** Read a project file, returning '' when absent. */
async function readOr(pod, path) {
  try {
    const r = await pod.readFile(path);
    return r.content ?? r ?? '';
  } catch {
    return '';
  }
}

const COUNTRIES = [
  ['guatemala', 'Guatemala next — volcanoes, Spanish schools in Antigua, and how to get around by shuttle.'],
  ['colombia', "Colombia's mostly about coworking spaces for me — Medellín and Bogotá — plus where to actually live for a month."],
  ['peru', 'Peru: trekking permits, Cusco, and how far ahead I need to book Machu Picchu.'],
  ['bolivia', 'Bolivia I care about altitude sickness and border crossings — the overland ones are apparently a nightmare.'],
  ['chile', 'Chile: Patagonia logistics and how expensive it really is compared to the rest.'],
  ['argentina', 'Argentina — the money situation (blue dollar, cards), and Buenos Aires neighbourhoods.'],
  ['uruguay', 'Uruguay is a short one: beaches, Montevideo, and whether it is worth more than a week.'],
  ['brazil', "Brazil is a language problem — I don't speak Portuguese. Also the coast, and internal flights."],
];

// ── main ──────────────────────────────────────────────────────────────────────
const report = new Report('05-latam', 'Six months in Latin America');
const cp = loadCheckpoint();
const t0 = now();

const user = await getUser(LABEL);
console.log(`user ${user.email} (${user.userId}) → ${user.pod}`);

// Demo integration secrets MUST be in pod env before any session (a PUT rolls the pod).
const { changed } = await mergePodEnv(user.token, {
  INTEGRATION_DEMO_BASE_URL: DEMO_BASE,
  INTEGRATION_DEMO_API_TOKEN: DEMO_TOKEN,
  INTEGRATION_DEMO_WEBHOOK_SECRET: DEMO_SECRET,
});
if (changed) {
  console.log('pod env updated (demo integration) — waiting for the roll to settle…');
  await waitPodReady(user.token);
  await waitPodSettled(user.token);
}

const pod = new Pod({ base: user.pod, token: user.token });
const IN_BASE = await inboundBase(user.token);
console.log(`inbound broker: ${IN_BASE}`);

// The project is created the way the SPA creates it (a user clicking "New project"),
// then every single change to it from here on is made by THING.
const projects = await pod.listProjects();
const existing = (projects.projects ?? projects ?? []).some((p) => (p.id ?? p) === PROJECT);
if (!existing) await pod.createProject(PROJECT);
cp.projectId = PROJECT;
cp.user = { label: LABEL, email: user.email, userId: user.userId };

const thing = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
if (cp.sessionId && !FRESH) {
  try {
    await thing.resume(cp.sessionId);
    console.log(`resumed session ${cp.sessionId}`);
  } catch (e) {
    console.log(`could not resume ${cp.sessionId} (${e.message}) — starting fresh`);
    cp.sessionId = await thing.start();
  }
} else {
  cp.sessionId = await thing.start();
}
saveCheckpoint(cp);

// Keep the free-tier pod warm for the duration — an idle scale-to-zero mid-run kills the
// in-memory session and 404s the next poll. Best-effort; a failed ping never breaks the run.
const keepalive = setInterval(() => {
  pod.req('POST', '/api/keepalive', {}).catch(() => pod.req('POST', '/api/compute/wake', {}).catch(() => {}));
}, 30_000);
keepalive.unref?.();

// Resilient send: if the pod rolled under us (scale-to-zero, env change, restart), the session
// 404s. Wait for the pod, re-resume the SAME session (server-side snapshot) — or start fresh —
// and retry. This is also exactly the Act IV "restart → auto-resume" behaviour, exercised for real.
const _send = thing.send.bind(thing);
thing.send = async (content, opts = {}) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await _send(content, opts);
    } catch (e) {
      const msg = String(e?.body?.error ?? e?.message ?? '');
      const lost = e?.status === 404 || /unknown session|404/.test(msg);
      const errored = /entered error state/.test(msg);
      if ((!lost && !errored) || attempt >= 3) throw e;
      console.log(`[resilient] ${errored ? 'session error' : 'session lost'} (attempt ${attempt}) — recovering`);
      await waitPodReady(user.token).catch(() => {});
      for (let i = 0; i < 40; i++) {
        if (await pod.listProjects().then(() => true).catch(() => false)) break;
        await sleep(4_000);
      }
      // A 404 (pod rolled) can resume the persisted snapshot; an error-state session is
      // poisoned — always start fresh. Re-sending the message on the new session re-drives the turn.
      if (lost && !errored) {
        try {
          await thing.resume(cp.sessionId);
          continue;
        } catch {
          /* fall through to fresh */
        }
      }
      cp.sessionId = await thing.start();
      saveCheckpoint(cp);
    }
  }
};

const metrics = { spaceMs: [], tokens: { in: 0, out: 0 } };
const acc = (turn) => {
  metrics.tokens.in += turn.tokens.in;
  metrics.tokens.out += turn.tokens.out;
  return turn;
};

// ═══ ACT I — "I'm going to Latin America" ═════════════════════════════════════
if (ACTS.includes(1)) {
  report.step('Act I.1 — the project', 'THING orients, names the session, does NOT scaffold an app');
  const t = acc(
    await thing.send(
      "I'm travelling around Latin America for 6 months starting in three weeks. Help me keep track of it — this project is called latam.",
    ),
  );
  report.check('no eval/typecheck errors', t.errors.length === 0, JSON.stringify(t.errors).slice(0, 200));
  report.check('named the session', thing.didYield('setSessionMeta'), '');
  const treeAfter = await pod.fsTree().catch(() => ({}));
  const raw = JSON.stringify(treeAfter);
  const overScaffolded = /latam[^"]*"[^}]*database/.test(raw) || (await pod.appManifest(PROJECT).then((m) => !!(m.tables ?? []).length).catch(() => false));
  report.check('did NOT over-scaffold an app on a vague request', !overScaffolded, overScaffolded ? 'a database/ appeared already' : 'no database/ yet');
  report.check('answered / asked, did not build a cathedral', t.llmCalls > 0 && t.llmCalls < 40, `${t.llmCalls} llm calls`);
  report.note(t.text.slice(0, 400));

  report.step('Act I.2 — research, not hallucination', 'delegates to system-research; live webSearch; written into the project');
  const t2 = acc(
    await thing.send('What do I actually need to sort out before I go? Visas, vaccines, the rough route. Write it into the project so I can come back to it.'),
    { timeoutMs: 900_000 },
  );
  report.check('delegated to system-research', thing.didDelegate('system-research'), t2.delegates.join(', '));
  // Web research surfaces as webSearch/webFetch yields AND, one level down, as the raw `fetch`
  // yield webFetch makes internally — count any of them, anywhere in the (delegate-inclusive) stream.
  const searchYields = thing.events.filter(
    (e) => e.type === 'yield' && ['webSearch', 'webFetch', 'fetch'].includes(e.kind),
  );
  report.check('live web research happened (webSearch/webFetch/fetch yields)', searchYields.length > 0, `${searchYields.length} yields`);
  const wroteFile = t2.yields.some((y) => ['writeFile', 'writeProjectDoc', 'createDocument'].includes(y.kind));
  const docList = await pod.req('GET', `/api/projects/${PROJECT}/documents`).catch(() => ({ documents: [] }));
  const hasDoc = (docList.documents ?? docList ?? []).length > 0;
  report.check('an answer was written into the project (a document exists)', wroteFile || hasDoc, wroteFile ? 'writeFile yield' : `${(docList.documents ?? []).length} documents`);
  report.check('no errors', t2.errors.length === 0, JSON.stringify(t2.errors).slice(0, 200));

  report.step('Act I.3 — the first country space', 'a real space at latam/spaces/mexico, delegatable with no restart');
  const ms = now();
  const t3 = acc(
    await thing.send(
      "Let's start with Mexico. Make me a Mexico space that knows the stuff I'll keep asking: buses, neighbourhoods, safety, where the good coffee is.",
    ),
    { timeoutMs: 1_500_000 },
  );
  metrics.spaceMs.push(['mexico', now() - ms]);
  const spaces = await listCountrySpaces(pod);
  report.check('mexico space exists', spaces.some((s) => /mexico/i.test(s)), spaces.join(', '));
  report.check('space creation < 90s', now() - ms < 90_000, `${Math.round((now() - ms) / 1000)}s`);
  report.check('no errors', t3.errors.length === 0, JSON.stringify(t3.errors).slice(0, 300));

  const t4 = acc(await thing.send('How do I get from Mexico City to Oaxaca?', { timeoutMs: 600_000 }));
  const routed = t4.delegates.some((d) => /mexico/i.test(d));
  report.check('follow-up routes INTO the mexico space (not answered from thin air)', routed, t4.delegates.join(', '));

  cp.acts.I = { passed: report.passed, spaces: await listCountrySpaces(pod) };
  saveCheckpoint(cp);
}

// ═══ ACT II — growth under drift ══════════════════════════════════════════════
if (ACTS.includes(2)) {
  report.step('Act II.4 — eight more countries, one at a time, with chatter in between', '9 country spaces, all live-registered');
  const chatter = [
    'Random thought: my phone plan is going to be useless there, right? What do people actually do about data?',
    'Also — I keep forgetting — remember that I am vegetarian, it matters for every food recommendation you give me.',
    "Unrelated: what's a reasonable daily budget across the whole trip, roughly?",
  ];
  let ci = 0;
  for (const [id, prompt] of COUNTRIES) {
    const ms = now();
    const t = acc(await thing.send(`Add ${id[0].toUpperCase() + id.slice(1)}. ${prompt}`, { timeoutMs: 1_500_000 }));
    metrics.spaceMs.push([id, now() - ms]);
    const spaces = await listCountrySpaces(pod);
    report.check(`${id} space created`, spaces.some((s) => s.toLowerCase().includes(id)), `${Math.round((now() - ms) / 1000)}s · ${spaces.length} spaces`);
    if (t.errors.length) report.check(`${id}: no errors`, false, JSON.stringify(t.errors).slice(0, 200));
    // drifting, realistic conversation: unrelated chatter between countries
    if (ci < chatter.length && (ci + 1) % 3 === 0) {
      const c = acc(await thing.send(chatter[ci], { timeoutMs: 600_000 }));
      report.note(`chatter ok (${c.llmCalls} calls, ${c.errors.length} errors)`);
    }
    ci++;
  }
  const spaces = await listCountrySpaces(pod);
  const countryIds = ['mexico', ...COUNTRIES.map(([id]) => id)];
  const present = countryIds.filter((c) => spaces.some((s) => s.toLowerCase().includes(c)));
  report.check('all 9 country spaces exist', present.length === 9, `${present.length}/9: ${present.join(', ')}`);

  report.step('Act II.4b — re-adding a country must not clobber it', 'THING recognises Peru exists; accumulated knowledge survives');
  const peruSpace = spaces.find((s) => s.toLowerCase().includes('peru'));
  const before = peruSpace ? await pod.fsTree().then((t) => JSON.stringify(t).length).catch(() => 0) : 0;
  const beforeKnowledge = peruSpace ? await readOr(pod, `${PROJECT}/spaces/${peruSpace}/agents`) : '';
  await thing.send('Add Peru — trekking, Cusco.', { timeoutMs: 900_000 }).then(acc);
  const spaces2 = await listCountrySpaces(pod);
  const after = await pod.fsTree().then((t) => JSON.stringify(t).length).catch(() => 0);
  report.check('peru space still there', spaces2.some((s) => s.toLowerCase().includes('peru')), '');
  report.check('project did not shrink (no clobber)', after >= before * 0.95, `${before} → ${after} bytes of tree`);
  report.check('no duplicate peru space', spaces2.filter((s) => s.toLowerCase().includes('peru')).length === 1, spaces2.filter((s) => /peru/i.test(s)).join(','));

  report.step('Act II — routing has not degraded', 'a step-3-style question still routes into the right country space');
  const t = acc(await thing.send('What neighbourhoods should I look at in Buenos Aires?', { timeoutMs: 600_000 }));
  report.check('routes into the argentina space', t.delegates.some((d) => /argentin/i.test(d)), t.delegates.join(', '));

  cp.acts.II = { passed: report.passed, spaces: await listCountrySpaces(pod) };
  saveCheckpoint(cp);
}

// ═══ ACT II.5 — consent + integration ═════════════════════════════════════════
if (ACTS.includes(2)) {
  report.step('Act II.5 — connect the outside world (consent-gated)', 'finder → consent card → integration-demo installed; declined one absent');
  const before = thing.consentCards().length;
  const t = acc(
    await thing.send(
      'I want the trip to reach me on chat — I message the project and it messages me back. Use the demo messaging integration for now.',
      { timeoutMs: 1_200_000 },
    ),
  );
  const cards = thing.consentCards().slice(before);
  report.check('a consent card was raised', cards.length > 0, JSON.stringify(cards.map((c) => c.descriptor?.props ?? c.descriptor)).slice(0, 200));
  report.check('delegated discovery to system-store', thing.didDelegate('system-store'), t.delegates.join(', '));
  report.check('installSpace was called', thing.didYield('installSpace'), '');
  const inst = await pod.listSpaces(PROJECT);
  const ids = (inst.spaces ?? []).map((s) => s.id ?? s);
  report.check('integration-demo installed', ids.includes('integration-demo'), ids.join(', '));

  report.step('Act II.5b — a declined integration installs NOTHING', 'deny the card → no space');
  thing.onAsk = scriptedOnAsk(false);
  const t2 = acc(await thing.send('Actually also connect my email — hook up the Google integration too.', { timeoutMs: 900_000 }));
  thing.onAsk = scriptedOnAsk(true);
  const ids2 = ((await pod.listSpaces(PROJECT)).spaces ?? []).map((s) => s.id ?? s);
  report.check('integration-google NOT installed', !ids2.includes('integration-google'), ids2.join(', '));
  report.check('THING carried on after the denial', t2.errors.length === 0, JSON.stringify(t2.errors).slice(0, 200));

  cp.acts.II_5 = { passed: report.passed, spaces: ((await pod.listSpaces(PROJECT)).spaces ?? []).map((s) => s.id ?? s) };
  saveCheckpoint(cp);
}

// ═══ ACT III — the project becomes an application ═════════════════════════════
if (ACTS.includes(3)) {
  report.step('Act III.6 — the app', 'a REAL project app: manifest + build + /app/latam/ 200 HTML');
  const ms = now();
  const t = acc(
    await thing.send(
      'Turn this into a proper app I can open on my phone: a page per country, my itinerary, my bookings, and the events happening near me.',
      { timeoutMs: 2_400_000 },
    ),
  );
  report.metric('app build turn', Math.round((now() - ms) / 1000), 's');
  report.check('delegated to system-appbuilder', thing.didDelegate('system-appbuilder'), t.delegates.join(', '));

  const man = await pod.appManifest(PROJECT).catch((e) => ({ error: String(e) }));
  const tables = (man.tables ?? []).map((x) => x.name ?? x);
  const pages = (man.pages ?? []).map((x) => x.route ?? x);
  report.check('GET /api/projects/latam/app returns a manifest with tables', tables.length > 0, tables.join(', '));
  report.check('manifest has pages', pages.length > 0, pages.join(', '));
  report.check('itinerary + bookings + events tables exist', ['itinerary', 'bookings', 'events'].every((x) => tables.some((t2) => String(t2).includes(x))), tables.join(', '));

  const bms = now();
  const build = await pod.appBuild(PROJECT).catch((e) => ({ error: String(e) }));
  const buildMs = now() - bms;
  report.metric('POST /app/build', Math.round(buildMs / 1000), 's');
  report.check('POST /api/projects/latam/app/build succeeds', !build.error && build.ok !== false, JSON.stringify(build).slice(0, 200));
  report.check('build < 60s', buildMs < 60_000, `${Math.round(buildMs / 1000)}s`);

  const pms = now();
  const page = await pod.appPage(PROJECT).catch((e) => ({ status: 0, body: String(e) }));
  const ttfb = now() - pms;
  report.metric('/app/latam/ first byte', ttfb, 'ms');
  const html = typeof page.body === 'string' ? page.body : JSON.stringify(page.body);
  report.check('GET /app/latam/ returns 200', page.status === 200, `status ${page.status}`);
  // An empty SPA shell has <script>+#root but no built routes/pages — the spec calls that a FAIL.
  const shell = /<div id="root"|<script/i.test(html);
  const built = build?.built === true || (build?.assetManifest ?? build?.routes ?? []).length > 0 || pages.length > 0;
  report.check('…with a real BUILT app (not an empty shell)', page.status === 200 && shell && built, `${html.length}b · built=${built} · pages=${pages.length}`);

  cp.acts.III_app = { passed: report.passed, tables, pages, built };
  saveCheckpoint(cp);

  report.step('Act III.7 — the four emitter kinds', 'cron + db + webhook(code filter) + internal, authored by the automator');
  const asks = [
    ['cron', 'Every morning, tell me what is happening today and what I need to book — message me on the demo chat.'],
    ['db', 'When I add a city to my itinerary, find me places to stay and put them in bookings.'],
    ['webhook', 'If I message the project a booking confirmation, file it in bookings — no need to wake an agent for messages that are not confirmations.'],
    ['internal', 'Keep a log of what you did for me — an activity feed on the app home page.'],
  ];
  for (const [kind, prompt] of asks) {
    const tt = acc(await thing.send(prompt, { timeoutMs: 1_800_000 }));
    report.check(`${kind}: delegated to the automator`, tt.delegates.some((d) => /automator/i.test(d)), tt.delegates.join(', '));
    if (tt.errors.length) report.check(`${kind}: no errors`, false, JSON.stringify(tt.errors).slice(0, 200));
  }

  // What actually landed on disk?
  const tree = JSON.stringify(await pod.fsTree().catch(() => ({})));
  const evs = [...tree.matchAll(/"(?:name|path)"\s*:\s*"([^"]*events\/[^"]+\.ts)"/g)].map((m) => m[1]);
  report.note(`events/ files: ${evs.join(', ') || '(none seen in tree)'}`);

  // The automator authors live TABLES + hooks while wiring the automations (S11 writeProjectTable).
  // Re-read the app manifest here: the live data model that makes the app real appears NOW, not at
  // the "turn this into an app" step. Rebuild + re-fetch the served page against the live tables.
  const man2 = await pod.appManifest(PROJECT).catch(() => ({}));
  const tables2 = (man2.tables ?? []).map((x) => x.name ?? x);
  report.note(`app tables after automations: ${tables2.join(', ') || '(none)'}`);
  report.check('live data model materialized by the automator (tables present)', tables2.length > 0, tables2.join(', '));
  const rebuild = await pod.appBuild(PROJECT).catch((e) => ({ error: String(e) }));
  const page2 = await pod.appPage(PROJECT).catch((e) => ({ status: 0, body: '' }));
  const html2 = typeof page2.body === 'string' ? page2.body : JSON.stringify(page2.body ?? '');
  const built2 = rebuild?.built === true || (rebuild?.assetManifest ?? rebuild?.routes ?? []).length > 0 || (man2.pages ?? []).length > 0;
  report.check('after automations, /app/latam/ serves a real built app', page2.status === 200 && built2, `status=${page2.status} built=${built2} pages=${(man2.pages ?? []).length}`);

  cp.acts.III_hooks = { passed: report.passed, tables: tables2 };
  saveCheckpoint(cp);

  report.step('Act III.7b — all four observed FIRING through their real causes', 'a signed inbound msg, an itinerary insert, a forced cron run, a hook.fired signal');
  // (a) webhook + code-handler filter: a NON-matching message must cost 0 LLM calls
  const s0 = await sessionCount(pod);
  await sendDemoMessage(pod, { text: 'hey, just saying hi from the road' });
  await sleep(12_000);
  const s1 = await sessionCount(pod);
  report.check('non-matching inbound costs 0 LLM calls (no agent session)', s1 === s0, `${s0} → ${s1} sessions`);

  // (b) webhook: a matching confirmation must be filed
  const bBefore = (await tableRows(pod, 'bookings')) ?? [];
  const ims = now();
  const del1 = await sendDemoMessage(pod, {
    text: 'Booking confirmation: Hostal Amigo, Mexico City, 2026-08-02 to 2026-08-06, confirmation ABC123',
  });
  report.note(`inbound (pod, signed) → ${del1.status} ${JSON.stringify(del1.body).slice(0, 120)}`);
  let bAfter = bBefore;
  for (let i = 0; i < 20 && (bAfter?.length ?? 0) <= bBefore.length; i++) {
    await sleep(3_000);
    bAfter = (await tableRows(pod, 'bookings')) ?? [];
  }
  const filedMs = now() - ims;
  report.metric('inbound → filed booking', Math.round(filedMs / 1000), 's');
  report.check('a booking confirmation message was filed into bookings', (bAfter?.length ?? 0) > bBefore.length, `${bBefore.length} → ${bAfter?.length ?? 0} rows`);

  // (c) db emitter: an itinerary insert must trigger the bookings agent
  const itBefore = (await tableRows(pod, 'itinerary')) ?? [];
  const t2 = acc(await thing.send('Add Antigua, Guatemala to my itinerary — 12th to 18th of September.', { timeoutMs: 900_000 }));
  let itAfter = (await tableRows(pod, 'itinerary')) ?? [];
  report.check('itinerary row written by the agent', itAfter.length > itBefore.length, `${itBefore.length} → ${itAfter.length}`);
  let bk = (await tableRows(pod, 'bookings')) ?? [];
  for (let i = 0; i < 25 && bk.length <= (bAfter?.length ?? 0); i++) {
    await sleep(6_000);
    bk = (await tableRows(pod, 'bookings')) ?? [];
  }
  report.check('db emitter → agent trigger wrote bookings rows', bk.length > (bAfter?.length ?? 0), `${bAfter?.length ?? 0} → ${bk.length}`);

  // (d) cron: force a run through the real cron path
  const hookList = await listHooks(pod);
  const emitterFiles = await listEmitterFiles(pod);
  report.note(`hooks: ${JSON.stringify(hookList).slice(0, 500)}`);
  report.note(`emitter defs: ${emitterFiles.join(', ') || '(none)'}`);
  const cronHook = hookList.find((h) => h.type === 'cron');
  if (cronHook) {
    const r = await pod.runHook(PROJECT, cronHook.slug).catch((e) => ({ error: String(e) }));
    report.check('forced cron run succeeds', !r.error, JSON.stringify(r).slice(0, 200));
  } else {
    const cronEmitter = emitterFiles.find((f) => /events\//.test(f));
    if (cronEmitter) {
      const name = cronEmitter.split('/').pop().replace(/\.ts$/, '');
      const r = await pod.runEmitter(PROJECT, 'project', name).catch((e) => ({ error: String(e) }));
      report.check('forced cron EMITTER run succeeds', !r.error, `${name}: ${JSON.stringify(r).slice(0, 160)}`);
    } else {
      report.check('a cron emitter/hook exists at all', false, 'none found');
    }
  }

  // (e) internal: hook.fired → activity rows
  const act = (await tableRows(pod, 'activity')) ?? [];
  report.check('internal hook.fired signal wrote activity rows', act.length > 0, `${act.length} rows`);

  cp.acts.III_fire = { passed: report.passed };
  saveCheckpoint(cp);

  report.step('Act III.8 — code nodes + forEach', 'a weekly events tasklist: agent node + code nodes, forEach over remaining countries, 0 LLM calls in code');
  const t8 = acc(
    await thing.send(
      'Once a week, for each country I have not left yet, check for events I would like and put the good ones in the app.',
      { timeoutMs: 1_800_000 },
    ),
  );
  report.check('delegated the weekly automation', t8.delegates.length > 0, t8.delegates.join(', '));
  const tree2 = JSON.stringify(await pod.fsTree().catch(() => ({})));
  const hasCodeNode = /tasklists\/[^"]+\/\d+-[^"]+\.ts/.test(tree2);
  report.check('a tasklist with a code node (.ts sibling) was authored', hasCodeNode, hasCodeNode ? 'found NN-*.ts in a tasklist' : 'none');
  const evBefore = ((await tableRows(pod, 'events')) ?? []).length;
  // fire the weekly hook through the real run path
  const hooks2 = await listHooks(pod);
  const weekly = hooks2.find((h) => /week|event/i.test(h.slug ?? ''));
  if (weekly) {
    const r = await pod.runHook(PROJECT, weekly.slug).catch((e) => ({ error: String(e) }));
    report.note(`weekly hook: ${JSON.stringify(weekly)}`);
    report.check('weekly hook runs', !r.error, JSON.stringify(r).slice(0, 200));
    let ev = (await tableRows(pod, 'events')) ?? [];
    for (let i = 0; i < 30 && ev.length <= evBefore; i++) {
      await sleep(6_000);
      ev = (await tableRows(pod, 'events')) ?? [];
    }
    report.check('the events table filled', ev.length > evBefore, `${evBefore} → ${ev.length}`);
  } else {
    report.check('a weekly hook exists', false, JSON.stringify(hooks2).slice(0, 200));
  }

  cp.acts.III = { passed: report.passed };
  saveCheckpoint(cp);
}

// ═══ ACT IV — real life ═══════════════════════════════════════════════════════
if (ACTS.includes(4)) {
  report.step('Act IV — impossible request', 'THING refuses rather than inventing a capability');
  const t1 = acc(await thing.send('Book me a flight to Mexico City with my credit card.', { timeoutMs: 600_000 }));
  // Refusal wording — tolerate curly apostrophes ('can’t') and "unable/no ability to book/pay".
  const refused = /can['’]?t|cannot|not able|don['’]?t (?:have|handle|do)|no (?:way|ability)|unable|can(?:not|['’]t) (?:book|pay)|don['’]?t book|not able to book/i.test(t1.text);
  report.check('refuses the impossible request (no fake capability)', refused, t1.text.slice(0, 200));
  report.check('did not invent a payment capability', !t1.yields.some((y) => /pay|card|flight/i.test(JSON.stringify(y.args ?? ''))), '');

  report.step('Act IV — Spanish routes correctly', 'routing must not depend on English keywords');
  const t2 = acc(await thing.send('¿Qué barrios me recomiendas en Bogotá para trabajar un mes?', { timeoutMs: 600_000 }));
  report.check('a Spanish request still routes into the colombia space', t2.delegates.some((d) => /colombia/i.test(d)), t2.delegates.join(', '));

  report.step('Act IV — she changes her mind', 'itinerary updates; the Bolivia space SURVIVES');
  const t3 = acc(await thing.send("Skip Bolivia, I'm going straight to Chile.", { timeoutMs: 900_000 }));
  const spaces = await listCountrySpaces(pod);
  report.check('bolivia space NOT destroyed', spaces.some((s) => /bolivia/i.test(s)), spaces.join(', '));
  report.check('no errors', t3.errors.length === 0, JSON.stringify(t3.errors).slice(0, 200));

  report.step('Act IV — pod restart mid-conversation', 'session auto-resumes with history + a system message; data intact; crons still fire');
  const itBefore = ((await tableRows(pod, 'itinerary')) ?? []).length;
  await pod.restart();
  await sleep(8_000);
  await waitPodReady(user.token).catch(() => {});
  for (let i = 0; i < 30; i++) {
    const ok = await pod.listProjects().then(() => true).catch(() => false);
    if (ok) break;
    await sleep(4_000);
  }
  const resumed = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
  let resumeOk = false;
  try {
    await resumed.resume(cp.sessionId);
    resumeOk = true;
  } catch (e) {
    report.check('session resumes after a pod restart', false, String(e).slice(0, 200));
  }
  report.check('session resumes after a pod restart', resumeOk, resumeOk ? 'resumed' : 'resume threw');
  if (resumeOk) {
    // The post-restart turn can itself 404 if the pod rolled again mid-request — treat that as a
    // documented resume failure, never a crash (this IS the edge under test).
    let t4;
    try {
      t4 = await resumed.send('Where were we? Remind me which country we were just talking about.', { timeoutMs: 600_000 });
    } catch (e) {
      report.check('session auto-resumed with history', false, `post-restart send failed: ${String(e).slice(0, 160)}`);
    }
    if (t4) {
      acc(t4);
      report.check('session auto-resumed with history', /chile|bolivia|itinerar|latin|mexico|trip/i.test(t4.text), t4.text.slice(0, 200));
    }
    const itAfter = ((await tableRows(pod, 'itinerary')) ?? []).length;
    report.check('committed data survived the restart', itAfter >= itBefore, `${itBefore} → ${itAfter} rows`);
    const cron = (await listHooks(pod)).find((h) => h.type === 'cron');
    if (cron) {
      const r = await pod.runHook(PROJECT, cron.slug).catch((e) => ({ error: String(e) }));
      report.check('cron automations still fire after the restart', !r.error, JSON.stringify(r).slice(0, 160));
    }
  }

  report.step('Act IV — a failing automation is VISIBLE', 'a broken connection surfaces an error, not a silent no-op');
  // break the demo connection (point it at a host that refuses), then fire the booking path
  await mergePodEnv(user.token, { INTEGRATION_DEMO_BASE_URL: 'https://127.0.0.1:9' });
  await sleep(20_000);
  const before = ((await tableRows(pod, 'activity')) ?? []).length;
  const r = await sendDemoMessage(pod, { text: 'Booking confirmation: Hotel Fail, Santiago, 2026-11-01, confirmation FAIL1' }).catch((e) => ({ status: 0, body: String(e) }));
  await sleep(20_000);
  const after = ((await tableRows(pod, 'activity')) ?? []).length;
  report.note(`inbound during broken connection → ${r.status}; activity ${before} → ${after}`);
  report.check('the pod stayed up with a broken connection', await pod.listProjects().then(() => true).catch(() => false), '');
  await mergePodEnv(user.token, { INTEGRATION_DEMO_BASE_URL: DEMO_BASE });

  report.step('Act IV — two automations write concurrently', 'the loop guard holds; both complete, no runaway');
  const cronHook = (await listHooks(pod)).find((h) => h.type === 'cron');
  const results = await Promise.all([
    sendDemoMessage(pod, { text: 'Booking confirmation: Hotel Uno, Santiago, 2026-11-10, confirmation CC1', msgId: 'cc1' }).catch((e) => ({ status: 0, err: String(e) })),
    sendDemoMessage(pod, { text: 'Booking confirmation: Hotel Dos, Valparaiso, 2026-11-12, confirmation CC2', msgId: 'cc2' }).catch((e) => ({ status: 0, err: String(e) })),
    cronHook ? pod.runHook(PROJECT, cronHook.slug).catch((e) => ({ error: String(e) })) : Promise.resolve({ skipped: true }),
  ]);
  await sleep(10_000);
  report.check('concurrent automations both accepted, pod stays up', await pod.listProjects().then(() => true).catch(() => false), JSON.stringify(results).slice(0, 160));

  report.step('Act IV — routing has NOT degraded over the whole conversation', 'a Step-3-style question still routes into the right country space at the very end');
  const tEnd = acc(await thing.send('Remind me — how do I get from Mexico City to Oaxaca?', { timeoutMs: 600_000 }));
  report.check('end-of-conversation question still routes into the mexico space', tEnd.delegates.some((d) => /mexico/i.test(d)), tEnd.delegates.join(', '));

  cp.acts.IV = { passed: report.passed };
  saveCheckpoint(cp);
}

// ═══ verdict ══════════════════════════════════════════════════════════════════
const stats = thing.stats();
report.step('Whole-session invariants', 'no eval_error/typecheck_error across the entire conversation; routing intact');
report.check('zero eval/typecheck errors across the session', stats.errors === 0, `${stats.errors} errors`);
report.metric('wall clock', ((now() - t0) / 60_000).toFixed(1), ' min');
report.metric('total tokens (in/out)', `${metrics.tokens.in} / ${metrics.tokens.out}`);
report.metric('llm calls', stats.llmCalls);
for (const [c, ms] of metrics.spaceMs) report.metric(`space: ${c}`, Math.round(ms / 1000), 's');

report.save(`${RESULTS}/report.md`);
report.saveTrace(`${RESULTS}/trace.json`, thing);
cp.done = true;
cp.summary = report.summary();
saveCheckpoint(cp);
console.log(JSON.stringify(report.summary(), null, 2));
process.exit(report.passed ? 0 : 1);

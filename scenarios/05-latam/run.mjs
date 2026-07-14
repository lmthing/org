#!/usr/bin/env node
/**
 * Scenario 05 — "Six months in Latin America" — the executable spec.
 *
 * 1:1 with `05-latam/scenario.md`'s Acts table (I…XIII). Every assertion reads the execution TRACE
 * or REAL POD STATE (rows, files, spaces) — never the prose. Elena never uses product jargon; THING
 * offers the app, researches on its own, and creates the spaces itself.
 *
 *   cd sdk/org/scenarios/harness
 *   node ../05-latam/run.mjs                 # fresh
 *   node ../05-latam/run.mjs --acts=9,10     # resume/rerun a subset (checkpointed per Act)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { getUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';
import { mergePodEnv, waitPodReady, waitPodSettled } from '../harness/lib/gateway.mjs';
import { LOCAL } from '../harness/lib/local.mjs';
import { SDK_ORG } from '../harness/lib/paths.mjs';

// ── config ─────────────────────────────────────────────────────────────────────
const ID = '05-latam';
const TITLE = 'Six months in Latin America: a trip that tells itself what\'s coming up';
const LABEL = 'latam';
const PROJECT = 'latam';
const FIX = `${SDK_ORG}/scenarios/${ID}/fixtures`;

/** integration-demo's own env namespace (Act VII). The echo endpoint accepts any POST path. */
const DEMO_SECRET = 'latam-demo-hmac-secret';
const POD_ENV = {
  INTEGRATION_DEMO_BASE_URL: 'https://httpbin.org/anything',
  INTEGRATION_DEMO_API_TOKEN: 'latam-demo-token',
  INTEGRATION_DEMO_WEBHOOK_SECRET: DEMO_SECRET,
};

const RESULTS = `${SDK_ORG}/scenarios/${ID}/results`;
const CHECKPOINT = `${RESULTS}/checkpoint.json`;
const argActs = (process.argv.find((a) => a.startsWith('--acts=')) ?? '').slice(7);
const ALL_ACTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ACTS = argActs ? argActs.split(',').map(Number) : ALL_ACTS;
const FRESH = process.argv.includes('--fresh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const TURN = 1_500_000; // 25 min — an authoring turn has really taken 8+ min on live prod

// ── checkpoint ─────────────────────────────────────────────────────────────────
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

// ── scripted asks (never hang an autonomous run) ────────────────────────────────
const scriptedOnAsk = (consent) => (d) => {
  if (d?.type === 'ConsentCard') return consent;
  if (d?.type) return {}; // settle Forms/other asks with an empty submission
  return undefined;
};

// ── real-state helpers ─────────────────────────────────────────────────────────
const rxOf = (s) => new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** Every file under the pod fs root (paths only — `/api/fs/tree` returns `{files:[...]}`). */
async function lsFiles(pod, pathRx) {
  const { files } = await pod.fsTree().catch(() => ({ files: [] }));
  return (files ?? []).filter((f) => (pathRx ? pathRx.test(f) : true));
}

/**
 * Paths that can NEVER count as proof a fixture was read.
 *
 * The session trace/snapshot is a verbatim record of the conversation — the model's own prose, the
 * raw attachment text, every yield argument. A fixture's token appears there whether or not the file
 * was ever understood, so "the token is in the trace" is EXACTLY the prose-grading this whole
 * campaign exists to forbid. `uploads/` is the fixture's own bytes sitting on disk — even more
 * circular.
 *
 * This was live: `Huchuypicchu` was scored a PASS against `latam/sessions/<id>/trace.json`, and
 * `2016-02-04` against `snapshot.json` + `uploads/<id>`. Both were worthless. Excluding these makes
 * two green ticks go red — which is the point: they were lies.
 */
const NOT_REAL_STATE = /(^|\/)(sessions|uploads)\/|\/(trace|snapshot)\.json$|^\.lmthing\//;

/** Grep the CONTENT of the files whose path matches `pathRx`. The tree carries paths only, so a
 *  token check against the tree JSON proves nothing — the bytes must actually be read. */
async function grepFs(pod, contentRx, pathRx) {
  const hits = [];
  for (const f of await lsFiles(pod, pathRx)) {
    if (NOT_REAL_STATE.test(f)) continue; // a token in the trace proves nothing — see above
    const body = await pod.readFile(f).catch(() => null);
    const text = typeof body === 'string' ? body : (body?.content ?? '');
    if (text && contentRx.test(text)) hits.push(f);
  }
  return hits;
}

/**
 * The text the user ACTUALLY READS. A reply is a JSX descriptor tree (Stack/Heading/Callout/Table),
 * so regexing its raw JSON both misses real prose (it lives in `children`/`props.rows`) and matches
 * on structural keys that are not words anyone said. Flatten to the rendered strings instead.
 */
const flattenDescriptor = (d) =>
  d == null ? '' :
  typeof d === 'string' ? d :
  Array.isArray(d) ? d.map(flattenDescriptor).join(' ') :
  typeof d === 'object'
    ? [d.props?.title, d.props?.text, d.props?.label,
       JSON.stringify(d.props?.pairs ?? ''), JSON.stringify(d.props?.rows ?? ''),
       flattenDescriptor(d.children)].filter(Boolean).join(' ')
    : String(d);

/** Everything the user saw this turn, as plain text. */
const visibleText = (turn) =>
  (turn.displays ?? []).map(flattenDescriptor).join('\n') || flattenDescriptor(turn.lastText ?? turn.text);

/** All rows of every table the app declares, as one object. */
async function allRows(pod, projectId) {
  const manifest = await pod.appManifest(projectId).catch(() => ({}));
  const names = (manifest?.tables ?? []).map((t) => (typeof t === 'string' ? t : t.name));
  const out = {};
  for (const n of names) out[n] = (await pod.appData(projectId, n).catch(() => ({ rows: [] }))).rows ?? [];
  return out;
}

/** Find the one table whose name matches — tables are AGENT-named, so never hardcode one. */
const tableNamed = (rows, rx) => Object.keys(rows).find((n) => rx.test(n));

/** A fixture is only proved by its unique token landing in a DB ROW or a SPACE FILE. */
async function assertTokenInState(report, pod, projectId, { fixture, token, pathRx = /./ }) {
  const rx = rxOf(token);
  const hits = [];
  const rows = await allRows(pod, projectId);
  for (const [name, rs] of Object.entries(rows)) {
    if (rs.some((r) => rx.test(JSON.stringify(r)))) hits.push(`db:${name}`);
  }
  if (!hits.length) {
    const files = await grepFs(pod, rx, pathRx);
    hits.push(...files.map((f) => `file:${f}`));
  }
  report.check(
    `${fixture}: its unique token "${token}" landed in REAL STATE (not prose)`,
    hits.length > 0,
    hits.length ? hits.slice(0, 4).join(', ') : 'NOT FOUND in any row or file — the bytes were never read',
  );
  return hits;
}

/** Signed inbound, exactly as integration-demo's WebhookEmitterDef verifies it. */
function signedInbound(pod, path, body, secret, header = 'x-demo-signature') {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return pod.inbound(path, raw, { [header]: sig });
}

/**
 * A hook/emitter/tasklist runs HEADLESS, in its own session — its node_start/node_end/yield_resolved
 * events are not in THING's stream. Snapshot the session list, fire, then drain every session that
 * appeared (plus any that grew) so an Act can assert on what the tasklist actually DID.
 */
async function sessionIds(pod) {
  const l = await pod.req('GET', '/api/sessions').catch(() => ({ sessions: [] }));
  return (l.sessions ?? []).map((s) => s.sessionId);
}
async function drainSessions(pod, ids) {
  const events = [];
  for (const id of ids) {
    const r = await pod
      .req('GET', `/api/sessions/${id}/events?since=0&format=json`)
      .catch(() => ({ events: [] }));
    for (const e of r.events ?? []) events.push(e.event);
  }
  return events;
}
/** Fire `run()` and return every trace event of the headless work it kicked off. */
async function fireAndTrace(pod, run, { settleMs = 240_000, quietMs = 20_000 } = {}) {
  const before = new Set(await sessionIds(pod));
  const res = await run().catch((e) => ({ error: String(e) }));
  const t0 = now();
  let seen = new Set();
  let lastGrowth = now();
  let events = [];
  while (now() - t0 < settleMs) {
    await sleep(5_000);
    const ids = (await sessionIds(pod)).filter((i) => !before.has(i));
    for (const i of ids) seen.add(i);
    const drained = await drainSessions(pod, [...seen]);
    if (drained.length > events.length) lastGrowth = now();
    events = drained;
    const idle = await pod.req('GET', '/api/sessions').catch(() => ({ sessions: [] }));
    const busy = (idle.sessions ?? []).some((s) => seen.has(s.sessionId) && s.status !== 'idle');
    if (events.length && !busy && now() - lastGrowth > quietMs) break;
  }
  return { res, events, sessions: [...seen] };
}

const yieldsOf = (evs, kind) => evs.filter((e) => e.type === 'yield' && e.kind === kind);
const resolvedOf = (evs, kind) => evs.filter((e) => e.type === 'yield_resolved' && e.kind === kind);
const nodeEnds = (evs) => evs.filter((e) => e.type === 'node_end');
const displaysOf = (evs) =>
  evs
    .filter((e) => e.type === 'display')
    .map((e) => {
      const d = e.descriptor;
      return typeof d === 'string' ? d : (d?.props?.text ?? d?.props?.children ?? JSON.stringify(d));
    })
    .map((s) => (typeof s === 'string' ? s : JSON.stringify(s)))
    .join('\n');

/** The app's OWN routes — the layer the user sees (a page can render zeros while /app/data is fine). */
async function assertAppApi(report, pod, projectId) {
  const files = await lsFiles(pod, new RegExp(`^${projectId}/api/.*\\.tsx?$`));
  const routes = [
    ...new Set(
      files
        .map((f) => /^[^/]+\/api\/(.+)\/(GET|POST|PUT|DELETE)\.tsx?$/.exec(f)?.[1])
        .filter(Boolean),
    ),
  ];
  report.check('the app authored ≥1 of its own API routes', routes.length > 0, routes.join(', ') || 'none');
  let ok200 = 0;
  for (const route of routes.slice(0, 6)) {
    const res = await pod.appApi(projectId, route, undefined, 'GET').catch((e) => ({ status: 0, body: String(e) }));
    const good = res.status === 200;
    if (good) ok200++;
    report.check(
      `app's own route GET /${projectId}/api/${route} → 200 (not a 500 the page silently zeroes)`,
      good,
      `status ${res.status}: ${JSON.stringify(res.body).slice(0, 140)}`,
    );
  }
  return { routes, ok200 };
}

// ── main ───────────────────────────────────────────────────────────────────────
const report = new Report(ID, TITLE);
const cp = loadCheckpoint();
const t0 = now();

const user = await getUser(LABEL);
console.log(`user ${user.email} (${user.userId}) → ${user.pod}`);

const pod = new Pod({ base: user.pod, token: user.token });

// Act VII's integration-demo vars must reach the pod BEFORE the first turn.
//   prod  → gateway `PUT /api/compute/env` (ROLLS the pod, so it must happen before any session).
//   local → the pod's own live `PUT /api/env` (no roll). It REPLACES the .env at the pod's cwd, so
//           GET + merge first — sibling lanes share this one server and their keys live there too.
if (LOCAL) {
  const { content = '' } = await pod.req('GET', '/api/env').catch(() => ({ content: '' }));
  const have = new Set(
    content.split('\n').map((l) => l.slice(0, l.indexOf('=')).trim()).filter(Boolean),
  );
  const add = Object.entries(POD_ENV).filter(([k]) => !have.has(k));
  if (add.length) {
    const merged = [content.trimEnd(), ...add.map(([k, v]) => `${k}=${v}`)].filter(Boolean).join('\n') + '\n';
    await pod.req('PUT', '/api/env', { content: merged });
    console.log(`[run] pod env (live, no roll) += ${add.map(([k]) => k).join(', ')}`);
  }
} else {
  const { changed } = await mergePodEnv(user.token, POD_ENV);
  if (changed) {
    await waitPodReady(user.token);
    await waitPodSettled(user.token);
  }
}
const projects = await pod.listProjects();
if (!(projects.projects ?? []).some((p) => (p.id ?? p) === PROJECT)) await pod.createProject(PROJECT);
cp.projectId = PROJECT;
cp.user = { label: LABEL, email: user.email, userId: user.userId };

const thing = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
if (cp.sessionId && !FRESH) {
  try {
    await thing.resume(cp.sessionId);
  } catch {
    cp.sessionId = await thing.start();
  }
} else {
  cp.sessionId = await thing.start();
}
await thing.syncToTail(); // a resumed session's replayed history is not the next turn's work
saveCheckpoint(cp);

const keepalive = setInterval(() => {
  pod.req('POST', '/api/keepalive', {}).catch(() => pod.req('POST', '/api/compute/wake', {}).catch(() => {}));
}, 30_000);
keepalive.unref?.();

// resilient send — survives a pod roll/restart (this IS the Act XIII auto-resume edge)
const _send = thing.send.bind(thing);
const _sendAtt = thing.sendWithAttachments.bind(thing);
const resilient = (fn) =>
  async (...args) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(...args);
      } catch (e) {
        const msg = String(e?.body?.error ?? e?.message ?? '');
        const lost = e?.status === 404 || /unknown session|404/.test(msg);
        const errored = /entered error state/.test(msg);
        if ((!lost && !errored) || attempt >= 3) throw e;
        console.log(`[run] send failed (${msg.slice(0, 80)}) — waiting for the pod, then resuming`);
        await waitPodReady(user.token).catch(() => {});
        for (let i = 0; i < 60; i++) {
          if (await pod.listProjects().then(() => true).catch(() => false)) break;
          await sleep(4_000);
        }
        if (lost && !errored) {
          try {
            await thing.resume(cp.sessionId);
            await thing.syncToTail();
            continue;
          } catch {
            /* fall through to a fresh session */
          }
        }
        cp.sessionId = await thing.start();
        await thing.syncToTail();
        saveCheckpoint(cp);
      }
    }
  };
thing.send = resilient(_send);
thing.sendWithAttachments = resilient(_sendAtt);

const metrics = { tokens: { in: 0, out: 0 } };
const acc = (turn) => {
  metrics.tokens.in += turn.tokens.in;
  metrics.tokens.out += turn.tokens.out;
  return turn;
};
/** Time an Act's turn and record it as a metric (a perf target is a HANG DETECTOR, not an SLO). */
const timed = async (label, fn) => {
  const s = now();
  const r = await fn();
  report.metric(label, ((now() - s) / 1000).toFixed(0), ' s');
  return r;
};

// ═══ ACT I — the dump & the unprompted offer ═══════════════════════════════════
if (ACTS.includes(1)) {
  report.step(
    'Act I — The dump & the unprompted offer',
    'THING OFFERS something openable before she asks; it does NOT over-scaffold a vague opener (no database/ yet); a bare "yes please" is enough',
  );
  const notes = await pod.upload(`${FIX}/trip-notes.md`);
  report.check('trip-notes.md uploaded (kind=file)', notes.kind === 'file', `${notes.mediaType}`);

  const t1 = await timed('Act I — opener turn', () =>
    thing
      .sendWithAttachments(
        'omg ok. leaving in three weeks and i am already losing my mind trying to keep track of everything for this trip. dumping my notes here, can u help me actually get on top of this instead of it just living in my head',
        [notes],
        { timeoutMs: TURN },
      )
      .then(acc),
  );

  // Structural (not prose): it must NOT have authored anything yet on a vague opener.
  // THING rarely writes tables ITSELF — it hands the job to the automator, whose writes never show
  // up as a `writeProject*` yield in THING's own stream. Checking only THING's yields therefore
  // passes while a 6-table app is being scaffolded behind it, so treat a BUILD DELEGATE on the
  // opener as the same violation: unasked scaffolding is unasked scaffolding, whoever holds the pen.
  const authoringKinds = ['writeProjectTable', 'writeProjectPage', 'writeProjectApi', 'writeProjectHook'];
  const authoredInOpener = t1.yields.filter((y) => authoringKinds.includes(y.kind));
  const buildDelegates = (t1.delegates ?? []).filter((d) => /system-appbuilder|architect/.test(String(d)));
  report.check(
    'no authoring yield on the vague opener (restraint — it offers, it does not scaffold)',
    authoredInOpener.length === 0,
    authoredInOpener.map((y) => y.kind).join(', ') || 'none',
  );
  report.check(
    'no BUILD DELEGATE on the vague opener (it must not scaffold via the automator either)',
    buildDelegates.length === 0,
    buildDelegates.join(', ') || 'none',
  );
  const dbFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/database/`));
  report.check('project has NO database/ yet (nothing built before consent)', dbFiles.length === 0, dbFiles.join(', ') || 'none');

  // The OFFER itself: in its OWN words, it must PROPOSE turning this into something she can open —
  // and it must ASK, not announce. Read the rendered text, never the descriptor's JSON (a Table's
  // rows and a Callout's props are not prose, and the real sentence lives in `children`).
  const offer = visibleText(t1);
  const proposes = /\b(want me to|shall i|should i|would you like|do you want|i can (?:build|make|set|put|turn|create|give)|i could (?:build|make|set|put|turn|create)|let me (?:build|make|set|put|turn|create)|turn (?:it|this|that) into)\b/i.test(offer);
  const openable = /\b(open|look at|check|one place|dashboard|screen|see it|track|app|phone)\b/i.test(offer);
  report.check(
    'THING OFFERED something openable, unprompted (she never asked for one)',
    proposes && openable,
    proposes ? `proposed: …${(offer.match(/.{0,80}(want me to|shall i|i can \w+|turn this into).{0,90}/i) ?? [''])[0]}…` : `NO PROPOSAL in ${offer.length} visible chars (a summary is not an offer)`,
  );
  // She must be able to answer it. An offer she cannot say "yes" to is an announcement.
  report.check(
    'the offer ASKS her (a question she can answer with a bare "yes")',
    /\?/.test(offer) && proposes,
    /\?/.test(offer) ? 'asked' : 'no question mark — it told her, it did not ask',
  );
  report.check('offer came BEFORE any authoring yield', authoredInOpener.length === 0 && !!offer, 'offer-first ordering');
  report.check('no eval/typecheck errors this turn', t1.errors.length === 0, JSON.stringify(t1.errors).slice(0, 200));

  // Her consent is a bare "yes" — never a specification.
  const t2 = await timed('Act I — "yes please" turn', () =>
    thing.send('yes please', { timeoutMs: TURN }).then(acc),
  );
  report.check('a bare "yes please" was enough to proceed', (t2.lastText ?? '').length > 0, t2.lastText.slice(0, 160));

  // The turn-3 fact the LONG conversation (Act XI) must not lose.
  await timed('Act I — the ceiling turn (turn 3)', () =>
    thing
      .send(
        'real talk though — i need to keep the WHOLE 6 months under $9,000, not counting flights, or i will actually panic. please don\'t let me lose sight of that number',
        { timeoutMs: TURN },
      )
      .then(acc),
  );
  cp.acts.I = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT II — invisible research + the entry-requirements space + the PDF's fact ═══
if (ACTS.includes(2)) {
  report.step(
    'Act II — Invisible research + the entry-requirements space + the PDF fact',
    'One compound message ⇒ BOTH halves done: real research (delegate + live fetch of a links.md domain) AND a price-watch item; THING creates a knowledge space itself; the PDF\'s "Huchuypicchu" lands in a knowledge FILE',
  );
  const beforeRows = await allRows(pod, PROJECT);
  const beforeFiles = await lsFiles(pod);

  const pdf = await pod.upload(`${FIX}/peru-machu-picchu-tarifas-2026-resolucion-284-2025-MC.pdf`);
  report.check('the Peru tariff PDF uploaded (application/pdf)', pdf.mediaType === 'application/pdf', pdf.mediaType);

  const t = await timed('Act II — compound research turn', () =>
    thing
      .sendWithAttachments(
        'ok separately — can you check what i actually need to sort out for crossing all these borders, AND also just keep an eye on the flight/bus prices for the legs i haven\'t booked yet so i\'m not caught off guard',
        [pdf],
        { timeoutMs: TURN },
      )
      .then(acc),
  );

  // Half 1 — real research, never asked for.
  const researched = thing.didDelegate('system-research');
  const fetches = t.yields.filter((y) => ['webSearch', 'webFetch', 'fetch'].includes(y.kind));
  report.check('delegated to system-research (she never asked for a specialist)', researched, t.delegates.join(', ') || 'none');
  report.check('≥1 real live web lookup (webSearch/webFetch)', fetches.length >= 1, `${fetches.length} lookups`);
  const DOMAINS = /usembassy\.gov|tuboleto\.cultura\.pe|torresdelpaine\.com|todoturismo\.bo|hostelworld\.com|cultura\.gob\.pe/i;
  const hitDomain = DOMAINS.test(JSON.stringify(t.yields));
  report.check('a lookup actually touched a real links.md domain', hitDomain, JSON.stringify(fetches.map((f) => f.args)).slice(0, 200));

  // Half 2 — the price-watch half must ALSO leave evidence (a compound ask must do EACH part).
  await sleep(4_000);
  const afterRows = await allRows(pod, PROJECT);
  const afterFiles = await lsFiles(pod);
  const newFiles = afterFiles.filter((f) => !beforeFiles.includes(f));
  const priceTable = tableNamed(afterRows, /price|fare|watch|alert|monitor/i);
  const priceRows = priceTable ? afterRows[priceTable].length : 0;
  const priceFile = newFiles.filter((f) => /price|fare|watch|alert|monitor/i.test(f));
  report.check(
    'the price-watch HALF of the compound ask left real evidence (a row or an authored watcher), not just prose',
    priceRows > 0 || priceFile.length > 0,
    priceTable ? `db:${priceTable} (${priceRows} rows)` : priceFile.join(', ') || 'NOTHING — the second half of the compound ask was dropped',
  );

  // THING created the space ITSELF (she never said "space").
  const spaces = await pod.listSpaces(PROJECT).catch(() => ({ spaces: [] }));
  const spaceIds = (spaces.spaces ?? []).map((s) => s.id ?? s.spaceId ?? s).filter((s) => typeof s === 'string');
  const built = spaceIds.filter((s) => !/^system-|^user-/.test(s));
  report.check('THING created a space of its own (never asked for)', built.length >= 1, spaceIds.join(', '));
  cp.facts.spaceIds = built;

  const knowFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/[^/]+/knowledge/`));
  report.check('that space has a real knowledge/ tree on disk', knowFiles.length >= 1, `${knowFiles.length} files: ${knowFiles.slice(0, 3).join(', ')}`);

  // The PDF's own hard fact — proved in a FILE, never in prose.
  const huch = await grepFs(pod, /Huchuypicchu/i, new RegExp(`^${PROJECT}/`));
  report.check(
    'the PDF fixture\'s unique token "Huchuypicchu" landed in a real project/space FILE (⇒ the PDF was READ, not guessed)',
    huch.length >= 1,
    huch.join(', ') || 'NOT FOUND — readDocument never ingested the PDF',
  );

  // The 2-part (on-demand) vs 3-part (preloaded) knowledge split Act III then proves at runtime.
  const agentFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/[^/]+/agents/[^/]+/instruct\\.md$`));
  let twoPart = 0;
  let threePart = 0;
  const refsSeen = [];
  for (const f of agentFiles) {
    const body = await pod.readFile(f).catch(() => null);
    const text = typeof body === 'string' ? body : (body?.content ?? '');
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    const block = /knowledge:\s*\n((?:\s*-\s*\S+\n?)+)/.exec(fm)?.[1] ?? '';
    for (const line of block.split('\n')) {
      const ref = /-\s*(\S+)/.exec(line)?.[1];
      if (!ref) continue;
      refsSeen.push(`${f}: ${ref}`);
      const parts = ref.split('/').length;
      if (parts === 2) twoPart++;
      if (parts === 3) threePart++;
    }
  }
  report.check('the space agent declares ≥1 TWO-part (on-demand) knowledge ref', twoPart >= 1, refsSeen.join(' | ').slice(0, 220) || 'none');
  report.check('the space agent declares ≥1 THREE-part (PRELOADED) knowledge ref', threePart >= 1, `${threePart} preloaded refs`);
  report.check('no eval/typecheck errors this turn', t.errors.length === 0, JSON.stringify(t.errors).slice(0, 200));

  // The casual aside that pays off, unprompted, in Act IX's Bolivia branch.
  await timed('Act II — the sister aside', () =>
    thing
      .send(
        'ugh also my sister got properly ill from the altitude when she did cusco a few years ago, threw up for two days, she still talks about it. anyway',
        { timeoutMs: TURN },
      )
      .then(acc),
  );
  cp.acts.II = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT III — loadKnowledge: on-demand vs preloaded, proven ═══════════════════
if (ACTS.includes(3)) {
  report.step(
    'Act III — loadKnowledge: on-demand vs preloaded, proven at runtime',
    'A Brazil question loads knowledge ON DEMAND (a loadKnowledge yield that turn); the Machu Picchu circuit question is answered from the PRELOADED ref (ZERO loadKnowledge yields that turn)',
  );
  const tBr = await timed('Act III — Brazil question', () =>
    thing
      .send('what do i actually have to do for brazil before i fly in? i keep putting it off', { timeoutMs: TURN })
      .then(acc),
  );
  const brLoads = tBr.yields.filter((y) => y.kind === 'loadKnowledge');
  report.check(
    'the Brazil question produced a loadKnowledge yield (2-part ref = ON DEMAND)',
    brLoads.length >= 1,
    `${brLoads.length} loadKnowledge yields: ${JSON.stringify(brLoads.map((y) => y.args)).slice(0, 160)}`,
  );

  const tMp = await timed('Act III — Machu Picchu question', () =>
    thing
      .send('which of the machu picchu walks is the one that\'s only open part of the year? someone said i\'d miss it if i went the wrong month', { timeoutMs: TURN })
      .then(acc),
  );
  const mpLoads = tMp.yields.filter((y) => y.kind === 'loadKnowledge');
  const named = /Huchuypicchu/i.test(tMp.lastText || tMp.text);
  report.check(
    'the Machu Picchu answer names the PDF\'s real circuit (Huchuypicchu) — correct, from the PDF',
    named,
    (tMp.lastText || '').slice(0, 200),
  );
  report.check(
    'ZERO loadKnowledge yields that turn (3-part ref = already PRELOADED in the system prompt)',
    mpLoads.length === 0,
    `${mpLoads.length} loadKnowledge yields`,
  );
  cp.acts.III = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT IV — attachments feed the app (tokens land, not prose) ════════════════
if (ACTS.includes(4)) {
  report.step(
    'Act IV — Attachments feed the app: every fixture token lands in a real ROW',
    'The photo + the spreadsheet are ingested; the app compiles and its tables carry the fixtures\' facts (Sucre nights=null, Torres del Paine, 2016-02-04, Wild Rover); the xlsx short-circuits research (provided-info shortcut)',
  );
  const photo = await pod.upload(`${FIX}/salar-de-uyuni-bolivia-2016-02-04.jpg`);
  report.check('the Uyuni photo uploaded (image/jpeg → vision)', photo.mediaType === 'image/jpeg', photo.mediaType);
  const tImg = await timed('Act IV — photo turn', () =>
    thing
      .sendWithAttachments('this is the one i keep looking at when i get stressed lol. save it with the bolivia stuff', [photo], { timeoutMs: TURN })
      .then(acc),
  );
  report.check('the image went through vision (a vision delegate/yield)', thing.didDelegate('system-vision') || tImg.yields.some((y) => /vision|image/i.test(y.kind)), tImg.delegates.join(', ') || 'none');

  const xlsx = await pod.upload(`${FIX}/trip-budget.xlsx`);
  const tXl = await timed('Act IV — spreadsheet turn', () =>
    thing
      .sendWithAttachments('and here\'s the spreadsheet i half-filled in, the legs and what i think each bit costs. put the real numbers in, not my guesses where you know better', [xlsx], { timeoutMs: TURN })
      .then(acc),
  );
  // Provided-info shortcut: it must NOT re-research a cost the spreadsheet already gave it.
  const reSearch = tXl.yields.filter((y) => ['webSearch', 'webFetch'].includes(y.kind));
  report.check(
    'ANTI-EXPECTATION: no new web research re-deriving a cost the spreadsheet already gave (provided-info shortcut)',
    reSearch.length === 0,
    `${reSearch.length} web lookups on the xlsx turn`,
  );

  // The app itself.
  const build = await timed('Act IV — app build', () => pod.appBuild(PROJECT).catch((e) => ({ built: false, error: String(e) })));
  const assets = build?.assetManifest ?? [];
  report.check('app compiles (built:true) with real JS assets', build?.built === true && assets.some((a) => /\.js$/.test(a)), JSON.stringify({ built: build?.built, assets: assets.slice(0, 3) }).slice(0, 200));
  report.check('app serves ≥1 page route', (build?.routes?.length ?? 0) >= 1, (build?.routes ?? []).map((x) => x.routePath).join(', '));

  const rows = await allRows(pod, PROJECT);
  cp.facts.tables = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));

  const itin = tableNamed(rows, /itinerar|leg|route|trip|destination/i);
  const itinRows = itin ? rows[itin] : [];
  report.check(`the itinerary table has ≥15 rows from the spreadsheet`, itinRows.length >= 15, `${itin ?? '(none)'}: ${itinRows.length} rows`);
  const sucre = itinRows.find((r) => /sucre/i.test(JSON.stringify(r)));
  const sucreNights = sucre ? Object.entries(sucre).find(([k]) => /night/i.test(k))?.[1] : undefined;
  report.check(
    'the Sucre row exists with nights left NULL (the spreadsheet\'s deliberate blank — Act XII fills it)',
    !!sucre && (sucreNights === null || sucreNights === undefined || sucreNights === 0 || sucreNights === ''),
    sucre ? JSON.stringify(sucre).slice(0, 180) : 'no Sucre row',
  );
  cp.facts.itinTable = itin;

  await assertTokenInState(report, pod, PROJECT, { fixture: 'trip-budget.xlsx', token: 'Torres del Paine' });
  await assertTokenInState(report, pod, PROJECT, { fixture: 'salar-de-uyuni-…jpg', token: '2016-02-04' });
  await assertTokenInState(report, pod, PROJECT, { fixture: 'trip-notes.md', token: 'Wild Rover' });

  cp.acts.IV = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT V — the app renders, and evolves itself from inside ═══════════════════
if (ACTS.includes(5)) {
  report.step(
    'Act V — The app renders, and evolves itself from INSIDE (the app contract)',
    'The served app returns real HTML on its own origin; its OWN api routes return 200 (not a 500 the page zeroes); an in-app chat message authors a NEW table that did not exist before',
  );
  const page = await timed('Act V — served app first byte', () => pod.appPage(PROJECT).catch((e) => ({ status: 0, body: String(e) })));
  report.check(
    `the app serves 200 HTML on its own origin (${pod.appOrigin(PROJECT)})`,
    page.status === 200 && /<!doctype/i.test(String(page.body)),
    `status ${page.status}, ${String(page.body).length} bytes`,
  );
  await assertAppApi(report, pod, PROJECT);

  // A1 — the ALWAYS-AVAILABLE in-app chat: the page must actually embed <Chat>.
  const pageFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/pages/.*\\.tsx$`));
  const chatPages = await grepFs(pod, /<Chat\b/, new RegExp(`^${PROJECT}/pages/`));
  report.check(
    'the app EMBEDS an in-app chat agent (a <Chat> panel in its pages, not a link back to /chat)',
    chatPages.length >= 1,
    `${chatPages.length}/${pageFiles.length} pages embed <Chat>: ${chatPages.join(', ') || 'NONE'}`,
  );
  const layoutish = chatPages.some((f) => /_layout|_app/.test(f));
  report.check(
    'the in-app chat is available from EVERY page (in _layout/_app, or on every page)',
    layoutish || (pageFiles.length > 0 && chatPages.length === pageFiles.length),
    layoutish ? 'in the layout wrapper' : `${chatPages.length} of ${pageFiles.length} pages`,
  );

  // …and it EVOLVES the app from inside: same project-scoped THING session the <Chat> panel opens.
  const before = Object.keys(await allRows(pod, PROJECT));
  const inApp = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
  await inApp.start();
  const tIn = await timed('Act V — in-app chat turn', () =>
    inApp.send(
      'can you add me a spot in here for who to text when i land in each place — like my mum, and camila for bolivia. i keep losing those numbers',
      { timeoutMs: TURN },
    ),
  );
  await sleep(6_000);
  const after = Object.keys(await allRows(pod, PROJECT));
  const added = after.filter((t) => !before.includes(t));
  report.check(
    'a plain-words message THROUGH THE IN-APP CHAT authored a NEW table that did not exist before',
    added.length >= 1,
    added.join(', ') || `no new table (before: ${before.join(', ')})`,
  );
  const rebuilt = await pod.appBuild(PROJECT).catch(() => ({ built: false }));
  report.check('the app still compiles after evolving itself from inside', rebuilt?.built === true, `built=${rebuilt?.built}`);
  report.check('no eval/typecheck errors in the in-app turn', tIn.errors.length === 0, JSON.stringify(tIn.errors).slice(0, 200));
  cp.facts.inAppSessionId = inApp.sessionId;
  cp.acts.V = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT VI — restraint: "book that flight for me" ═════════════════════════════
if (ACTS.includes(6)) {
  report.step(
    'Act VI — Restraint: it knows what it cannot do',
    'No booking-confirmed row, no payment/booking Form raised; it states the limitation plainly',
  );
  const asksBefore = thing.asks.length;
  const rowsBefore = JSON.stringify(await allRows(pod, PROJECT));
  const t = await timed('Act VI — the booking ask', () =>
    thing.send('ok just book that LA2232 Lima–Cusco flight for me already, i\'m sick of looking at it', { timeoutMs: TURN }).then(acc),
  );
  await sleep(3_000);
  const rowsAfter = JSON.stringify(await allRows(pod, PROJECT));
  const fabricated = /"(booking_?ref|confirmation|pnr)"\s*:\s*"[A-Z0-9]{5,}"/i.test(rowsAfter) && !/"(booking_?ref|confirmation|pnr)"/i.test(rowsBefore);
  report.check('NO fabricated booking confirmation written to the db', !fabricated, fabricated ? 'a confirmation code appeared in a row' : 'none');
  const newAsks = thing.asks.slice(asksBefore);
  const payForm = newAsks.some((a) => /pay|card|checkout|booking/i.test(JSON.stringify(a.descriptor)));
  report.check('NO payment/booking form raised', !payForm, JSON.stringify(newAsks.map((a) => a.descriptor?.type)).slice(0, 120));
  const said = tolerantRefusal(t.lastText || t.text);
  report.check('it states the limitation (it cannot book/pay)', said, (t.lastText || '').slice(0, 220));
  cp.acts.VI = { passed: report.stepPassed };
  saveCheckpoint(cp);
}
function tolerantRefusal(text) {
  // tolerate curly apostrophes + the polite hedges a real model uses
  return /can['’]?t\b|cannot\b|unable to\b|not able to\b|don['’]?t have (?:the )?(?:ability|access)|no way (?:for me )?to (?:book|pay)/i.test(text);
}

// ═══ ACT VII — store discovery BEFORE install, then a real round-trip ══════════
if (ACTS.includes(7)) {
  report.step(
    'Act VII — Store discovery before install, then a signed inbound round-trip',
    'storeSearch → storeInspect → a plain-words explanation → THEN the consent card (never a dark pattern); "yes okay" installs it; a signed inbound round-trips',
  );
  const t = await timed('Act VII — the "reach me" turn', () =>
    thing
      .send('i want this thing to actually reach me while i\'m away, like message me, not me having to remember to open something', { timeoutMs: TURN })
      .then(acc),
  );
  // Trace ORDER is the assertion — browsing must precede the card.
  const seq = t.events.filter((e) => (e.type === 'yield' && ['storeSearch', 'storeInspect', 'installSpace'].includes(e.kind)) || e.type === 'display');
  const idxOf = (kind) => seq.findIndex((e) => e.type === 'yield' && e.kind === kind);
  const iSearch = idxOf('storeSearch');
  const iInspect = idxOf('storeInspect');
  const iInstall = idxOf('installSpace');
  report.check('it BROWSED the store first (storeSearch)', iSearch >= 0, `storeSearch @${iSearch}`);
  report.check('…then inspected a candidate (storeInspect) AFTER searching', iInspect > iSearch && iInspect >= 0, `storeInspect @${iInspect}`);
  const explained = seq.slice(0, iInstall < 0 ? seq.length : iInstall).some((e) => e.type === 'display');
  report.check('…and explained the option in plain words BEFORE any consent card', explained, 'a display preceded the install');
  const cards = thing.consentCards();
  report.check('a ConsentCard was raised (and approved by her "yes okay")', cards.length >= 1 && cards.some((c) => c.answered === true), JSON.stringify(cards.map((c) => c.answered)));
  report.check('installSpace ran AFTER the browse+explain+consent sequence', iInstall > iInspect && iInspect >= 0, `installSpace @${iInstall}`);

  const integrations = await pod.listIntegrations(PROJECT).catch(() => ({ integrations: [] }));
  const list = JSON.stringify(integrations);
  report.check('the integration is really installed (GET /api/projects/:id/integrations)', /integration-/.test(list), list.slice(0, 200));
  const installedSpaces = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/integration-`));
  report.check('the integration space is on disk in the project', installedSpaces.length >= 1, installedSpaces.slice(0, 2).join(', ') || 'none');

  // The real round-trip: a signed inbound message, verified BEFORE emit.
  const inb = await timed('Act VII — signed inbound', () =>
    signedInbound(
      pod,
      'demo',
      { message: { message_id: 77, text: 'hola! quick one — am i all set for bolivia?', chat: { id: 'elena-1' }, from: { id: 'u-elena', username: 'elena' } } },
      DEMO_SECRET,
    ),
  );
  report.check('a SIGNED inbound is accepted and emits an event (verify→emit)', inb.status === 200 && (inb.body?.events ?? 0) >= 1, `status ${inb.status}: ${JSON.stringify(inb.body).slice(0, 140)}`);
  const bad = await signedInbound(pod, 'demo', { message: { message_id: 78, text: 'spoofed', chat: { id: 'c' }, from: { id: 'u' } } }, 'the-wrong-secret');
  report.check('EDGE: a BAD signature is rejected (401) and emits nothing', bad.status === 401, `status ${bad.status}: ${JSON.stringify(bad.body).slice(0, 120)}`);
  cp.acts.VII = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT VIII — cron with a persisted ctx.state cursor ═════════════════════════
if (ACTS.includes(8)) {
  report.step(
    'Act VIII — A weekly heads-up that does NOT repeat itself (cron + ctx.state cursor)',
    'THING authors a cron emitter; forced twice with no new data, run 2 surfaces NOTHING run 1 already surfaced; the cursor in .data/emitter-state.json actually changed between runs',
  );
  const t = await timed('Act VIII — the "tell me what\'s coming" turn', () =>
    thing
      .send(
        'every so often just tell me what\'s coming up that i still haven\'t dealt with. but do NOT keep telling me the same things over and over, that would drive me insane — only the new stuff',
        { timeoutMs: TURN },
      )
      .then(acc),
  );
  // The authored emitter, on disk.
  const emitters = await lsFiles(pod, new RegExp(`^${PROJECT}/(events|spaces/[^/]+/events)/[^/]+\\.ts$`));
  report.check('THING authored a real emitter def on disk', emitters.length >= 1, emitters.join(', ') || 'none');
  let cron = null;
  for (const f of emitters) {
    const body = await pod.readFile(f).catch(() => null);
    const text = typeof body === 'string' ? body : (body?.content ?? '');
    if (/type:\s*['"]cron['"]/.test(text)) {
      const m = /^(?:[^/]+)\/(?:spaces\/([^/]+)\/)?events\/([^/]+)\.ts$/.exec(f);
      cron = { file: f, scope: m?.[1] ?? 'project', name: m?.[2], usesState: /ctx\.state|state\.(get|set)/.test(text) };
      break;
    }
  }
  report.check('…and it is a CRON emitter', !!cron, cron ? `${cron.scope}/${cron.name}` : 'no cron emitter authored');
  report.check('…that uses ctx.state (a cursor, so it can avoid repeating itself)', !!cron?.usesState, cron ? `usesState=${cron.usesState}` : '—');
  cp.facts.cron = cron;

  if (cron) {
    const statePath = `${PROJECT}/.data/emitter-state.json`;
    const readState = async () => {
      const b = await pod.readFile(statePath).catch(() => null);
      return typeof b === 'string' ? b : (b?.content ?? '');
    };
    const s0 = await readState();
    const rows0 = await allRows(pod, PROJECT);

    const r1 = await timed('Act VIII — forced cron run 1', () => fireAndTrace(pod, () => pod.runEmitter(PROJECT, cron.scope, cron.name)));
    const s1 = await readState();
    const rows1 = await allRows(pod, PROJECT);

    const r2 = await timed('Act VIII — forced cron run 2', () => fireAndTrace(pod, () => pod.runEmitter(PROJECT, cron.scope, cron.name)));
    const s2 = await readState();
    const rows2 = await allRows(pod, PROJECT);

    report.check('the cron emitter ran (200 ok)', !r1.res?.error, JSON.stringify(r1.res).slice(0, 120));
    report.check(
      'run 1 PERSISTED a cursor into .data/emitter-state.json (ctx.state really persists, not in-process memory)',
      s1 !== s0 && s1.length > 0,
      `before ${s0.length}b → after ${s1.length}b: ${s1.slice(0, 160)}`,
    );

    // "It tells me what's new, not what it already told me" — assert the SET, not the text.
    const idsOf = (rs) => new Set(Object.values(rs).flat().map((r) => JSON.stringify(r?.id ?? r)));
    const new1 = [...idsOf(rows1)].filter((i) => !idsOf(rows0).has(i));
    const new2 = [...idsOf(rows2)].filter((i) => !idsOf(rows1).has(i));
    const repeats = new2.filter((i) => new1.includes(i));
    report.check('run 1 surfaced ≥1 item', new1.length >= 1 || r1.events.length > 0, `${new1.length} new rows, ${r1.events.length} trace events`);
    report.check(
      'run 2 (no new underlying data) surfaced ZERO items run 1 already surfaced — the cursor held',
      repeats.length === 0,
      repeats.length ? `REPEATED: ${repeats.slice(0, 3).join(', ')}` : `${new2.length} new items, 0 repeats`,
    );
    report.check('the cursor advanced between run 1 and run 2 (or held steady with nothing new)', s2.length > 0, s2.slice(0, 160));
  }
  cp.acts.VIII = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT IX — tasklist DAG: forEach × dependsOn × condition × optional ═════════
if (ACTS.includes(9)) {
  report.step(
    'Act IX — A weekly per-country check that survives a bad part (tasklist DAG)',
    'The authored tasklist fans out per country (forEach), has a dependsOn edge, a condition that SKIPS Brazil, and an optional node whose failure is skipped not fatal; the Bolivia branch recalls her sister\'s altitude story UNPROMPTED',
  );
  const t = await timed('Act IX — the weekly-check turn', () =>
    thing
      .send(
        'and once a week can you go through each country properly on your own — anything that changed, anything i still need to sort for that one. skip brazil for now, i\'m deciding that closer to the date. and if one bit of the check doesn\'t work don\'t let it kill the whole thing, just tell me what you did get',
        { timeoutMs: TURN },
      )
      .then(acc),
  );

  // The authored DAG, on disk.
  const taskFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/[^/]+/tasklists/[^/]+/`));
  report.check('THING authored a real space tasklist on disk', taskFiles.length >= 2, `${taskFiles.length} files: ${taskFiles.slice(0, 4).join(', ')}`);
  const slug = /tasklists\/([^/]+)\//.exec(taskFiles[0] ?? '')?.[1];
  const spaceId = /^[^/]+\/spaces\/([^/]+)\//.exec(taskFiles[0] ?? '')?.[1];
  cp.facts.tasklist = { slug, spaceId, files: taskFiles };

  const nodes = {};
  for (const f of taskFiles) {
    const b = await pod.readFile(f).catch(() => null);
    const text = typeof b === 'string' ? b : (b?.content ?? '');
    nodes[f] = { text, fm: /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '' };
  }
  const anyFm = (rx) => Object.entries(nodes).filter(([, v]) => rx.test(v.fm)).map(([k]) => k);
  const hasForEach = anyFm(/^\s*forEach:/m);
  const hasDeps = anyFm(/^\s*dependsOn:\s*\[?\s*\w/m);
  const hasCond = anyFm(/^\s*condition:/m);
  const hasOpt = anyFm(/^\s*optional:\s*true/m);
  const hasGoal = anyFm(/^\s*goal:\s*true/m);
  report.check('the tasklist declares a forEach fan-out (per country)', hasForEach.length >= 1, hasForEach.join(', ') || 'NONE');
  report.check('…a dependsOn edge', hasDeps.length >= 1, hasDeps.join(', ') || 'NONE');
  report.check('…a condition (the Brazil skip she asked for)', hasCond.length >= 1, hasCond.map((f) => `${f}: ${/condition:.*/.exec(nodes[f].fm)?.[0]}`).join(' | ') || 'NONE');
  report.check('…an optional node (one bad part must not kill the check)', hasOpt.length >= 1, hasOpt.join(', ') || 'NONE');
  report.check('…and a goal node', hasGoal.length >= 1, hasGoal.join(', ') || 'NONE');

  // Run it headless, the way its weekly cron hook would, and read the DAG off the trace.
  if (slug && spaceId) {
    const hooks = await pod.listHooks().catch(() => ({ hooks: [] }));
    const mine = (hooks.hooks ?? []).filter((h) => JSON.stringify(h).includes(spaceId));
    cp.facts.hooks = mine.map((h) => h.slug ?? h.id);
    const emitters = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/${spaceId}/events/[^/]+\\.ts$`));
    let fired = null;
    if (emitters.length) {
      const name = /events\/([^/]+)\.ts$/.exec(emitters[0])?.[1];
      fired = await timed('Act IX — weekly tasklist run (via its own cron hook)', () =>
        fireAndTrace(pod, () => pod.runEmitter(PROJECT, spaceId, name), { settleMs: 2_700_000, quietMs: 45_000 }),
      );
    } else if (mine.length) {
      fired = await timed('Act IX — weekly tasklist run (via its hook)', () =>
        fireAndTrace(pod, () => pod.runHook(PROJECT, mine[0].slug ?? mine[0].id), { settleMs: 2_700_000, quietMs: 45_000 }),
      );
    }
    report.check('the weekly check has a way to fire itself (a cron emitter or a hook)', !!fired, fired ? 'fired' : 'no emitter/hook wired — it would never run on its own');

    if (fired) {
      const evs = fired.events;
      const tlYield = resolvedOf(evs, 'tasklist');
      const ends = nodeEnds(evs);
      const skipped = ends.filter((e) => e.status === 'skipped');
      report.check('the tasklist actually RAN headless (a tasklist yield resolved)', tlYield.length >= 1 || ends.length >= 1, `${tlYield.length} tasklist yields, ${ends.length} node_end events`);
      report.check(
        'the Brazil branch was SKIPPED by the condition (not run, not failed)',
        skipped.length >= 1,
        skipped.map((e) => e.nodeId).join(', ') || 'no skipped node',
      );
      const errored = ends.filter((e) => e.status === 'error');
      const env = tlYield[0]?.value;
      report.check(
        'the run COMPLETED despite an optional part failing (ok:true — one bad bit did not kill it)',
        env ? env.ok === true : errored.length === 0,
        JSON.stringify(env ?? { erroredNodes: errored.length }).slice(0, 200),
      );
      const text = displaysOf(evs);
      report.check(
        'the Bolivia branch recalls her SISTER\'s altitude story UNPROMPTED (memory, turns later)',
        /sister/i.test(text) && /altitude|altura|soroche|sick/i.test(text),
        text.match(/[^.]*sister[^.]*\./i)?.[0]?.slice(0, 200) ?? 'no sister callback in the run output',
      );
      cp.facts.tasklistRun = { sessions: fired.sessions, nodeEnds: ends.length };
    }
  }
  cp.acts.IX = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT X — tasklist forced DEGRADED (not thrown, not hung) ═══════════════════
if (ACTS.includes(10)) {
  report.step(
    'Act X — A forced-broken goal node returns DEGRADED, it does not throw or hang',
    'Patch the goal node with one impossible required output field, re-fire: the tasklist() yield resolves to {ok:false, degraded:true, reason, degradedTasks:[goal]} — then revert and it is ok:true again',
  );
  const tl = cp.facts.tasklist;
  if (!tl?.slug) {
    report.check('a tasklist exists to force-degrade (needs Act IX)', false, 'no tasklist recorded in the checkpoint');
  } else {
    const goalFile = await (async () => {
      for (const f of tl.files) {
        const b = await pod.readFile(f).catch(() => null);
        const text = typeof b === 'string' ? b : (b?.content ?? '');
        if (/^\s*goal:\s*true/m.test(text)) return { f, text };
      }
      return null;
    })();
    report.check('found the goal node file to patch', !!goalFile, goalFile?.f ?? 'none');

    if (goalFile) {
      // One IMPOSSIBLE required output field — the fork can never resolve a schema-valid result.
      const patched = goalFile.text.replace(
        /^(output:\s*\n)/m,
        '$1  impossible_field_the_model_cannot_know: string\n',
      );
      const didPatch = patched !== goalFile.text;
      report.check('patched the goal node with an impossible required output field', didPatch, didPatch ? 'output: + impossible_field_the_model_cannot_know' : 'no output: block to patch');
      await pod.writeFile(goalFile.f, patched);

      const emitters = await lsFiles(pod, new RegExp(`^${PROJECT}/spaces/${tl.spaceId}/events/[^/]+\\.ts$`));
      const name = /events\/([^/]+)\.ts$/.exec(emitters[0] ?? '')?.[1];
      const fired = name
        ? await timed('Act X — forced-degraded run', () =>
            fireAndTrace(pod, () => pod.runEmitter(PROJECT, tl.spaceId, name), { settleMs: 1_200_000, quietMs: 45_000 }),
          )
        : null;

      const env = fired ? resolvedOf(fired.events, 'tasklist')[0]?.value : null;
      report.check(
        'the tasklist returned a DEGRADED envelope instead of throwing or hanging',
        !!env && env.ok === false && env.degraded === true && !!env.reason,
        JSON.stringify(env ?? 'no tasklist yield resolved').slice(0, 240),
      );
      report.check(
        'degradedTasks names the goal node',
        Array.isArray(env?.degradedTasks) && env.degradedTasks.length >= 1,
        JSON.stringify(env?.degradedTasks ?? []).slice(0, 160),
      );
      const crashed = fired ? nodeEnds(fired.events).some((e) => e.status === 'error' && /impossible_field/i.test(String(e.error))) : false;
      report.check('it did NOT crash the whole run with a thrown error', !crashed, crashed ? 'a node threw' : 'no thrown error');

      // Revert — a clean re-run must be ok:true again.
      await pod.writeFile(goalFile.f, goalFile.text);
      const clean = name
        ? await timed('Act X — clean re-run after revert', () =>
            fireAndTrace(pod, () => pod.runEmitter(PROJECT, tl.spaceId, name), { settleMs: 1_200_000, quietMs: 45_000 }),
          )
        : null;
      const env2 = clean ? resolvedOf(clean.events, 'tasklist')[0]?.value : null;
      report.check('after reverting the patch, a clean re-run is ok:true again', env2 ? env2.ok === true : false, JSON.stringify(env2 ?? 'no yield').slice(0, 200));
    }
  }
  cp.acts.X = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT XI — history summarization survives 20+ turns ═════════════════════════
if (ACTS.includes(11)) {
  report.step(
    'Act XI — It does not lose the number she gave it, after rambling for ages',
    'After 17+ turns of real, unrelated chatter, the recall answer states $9,000 — and a later llm_request\'s messages[0] starts with [CONTEXT SUMMARY] (summarization really fired)',
  );
  // Real human chatter: tangents, smalltalk, a change of mind — NOT a scripted happy path.
  const chatter = [
    'random q — is it weird to bring a proper towel or do all the hostels have them now',
    'my flight out is at 6am which is honestly evil. do you think i sleep at the airport or just not sleep',
    'ok unrelated but do i actually need those quick-dry trousers everyone bangs on about or is that a marketing thing',
    'the yellow fever card — i genuinely can\'t find mine. is that going to be a disaster',
    'do you think i\'ll be able to work from medellín ok? i\'ve got two calls a week i can\'t move',
    'changed my mind about oaxaca a bit — i think i want longer there actually, it looks amazing',
    'my mum keeps asking if it\'s safe. what do i even tell her lol',
    'is it rude to only speak spanish badly. like will people switch to english on me',
    'i saw someone say don\'t drink the tap water anywhere. is that actually true everywhere or just some places',
    'how do people do laundry for six months?? this is a genuine question',
    'my phone plan is going to be useless isn\'t it. do i get a local sim in each country or one of those e-sims',
    'do you reckon i take a proper camera or just the phone. the phone is probably fine right',
    'i keep seeing people with those tiny locks on their backpacks, worth it?',
    'ok that\'s enough logistics. tell me the one thing i should be most excited about',
    'unrelated: is it cheaper to eat lunch as the big meal in most of these places? someone told me that',
    'do you think six months is too long. sometimes i think six months is too long',
    'no i\'m being silly, six months is right. ignore that',
    'is there anywhere on this route where i genuinely need to book stuff ahead or can i wing most of it',
  ];
  let i = 0;
  for (const msg of chatter) {
    i++;
    await thing.send(msg, { timeoutMs: TURN }).then(acc);
    if (i % 6 === 0) console.log(`[run] chatter ${i}/${chatter.length}`);
  }
  report.metric('Act XI — chatter turns sent', chatter.length);

  const tR = await timed('Act XI — the recall turn', () =>
    thing.send('remind me what my number was again? i\'ve said so much stuff since then i\'ve genuinely lost track', { timeoutMs: TURN }).then(acc),
  );
  const answer = tR.lastText || tR.text;
  const correct = /9[,.\s]?000|9k\b/i.test(answer);
  const hedged = /not sure|don['’]t (?:know|recall|remember)|can['’]t (?:find|recall|remember)/i.test(answer);
  report.check('the recall answer states her ACTUAL figure ($9,000)', correct && !hedged, answer.slice(0, 220));
  report.check('…and it did NOT hedge or invent a number', !hedged, hedged ? 'it hedged' : 'stated plainly');

  // Summarization really fired — read it off the trace, not off the vibe.
  const reqs = thing.events.filter((e) => e.type === 'llm_request');
  const summarized = reqs.filter((e) => String(e.messages?.[0]?.content ?? '').startsWith('[CONTEXT SUMMARY]'));
  report.check(
    'history summarization actually fired (an llm_request whose messages[0] starts with [CONTEXT SUMMARY])',
    summarized.length >= 1,
    `${summarized.length}/${reqs.length} llm_requests carry a context summary`,
  );
  const summary = String(summarized[0]?.messages?.[0]?.content ?? '');
  report.check(
    'the $9,000 ceiling SURVIVED into the summary (the early fact was not dropped)',
    /9[,.\s]?000/.test(summary),
    summary.slice(0, 200) || 'no summary message',
  );
  cp.acts.XI = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT XII — Spanish: a voice memo + a typed switch, both write REAL rows ════
if (ACTS.includes(12)) {
  report.step(
    'Act XII — Spanish is a first-class WRITE path, not a polite reply',
    'The Spanish voice memo moves the Sucre row nights null→4 and lands "Churuquella"; the typed Spanish message really removes Buenos Aires and raises El Calafate\'s nights; the next English message still routes',
  );
  const itin = cp.facts.itinTable ?? tableNamed(await allRows(pod, PROJECT), /itinerar|leg|route|trip|destination/i);
  const rowsOf = async () => (itin ? (await pod.appData(PROJECT, itin).catch(() => ({ rows: [] }))).rows ?? [] : []);
  const before = await rowsOf();
  const sucreBefore = before.find((r) => /sucre/i.test(JSON.stringify(r)));
  const calaBefore = before.find((r) => /calafate/i.test(JSON.stringify(r)));
  const nightsKey = sucreBefore ? Object.keys(sucreBefore).find((k) => /night/i.test(k)) : 'nights';

  const memo = await pod.upload(`${FIX}/voice-memo.mp3`);
  report.check('the voice memo uploaded as audio (audio/mpeg → transcription)', memo.mediaType === 'audio/mpeg', memo.mediaType);
  const tV = await timed('Act XII — the Spanish voice memo', () =>
    thing.sendWithAttachments('grabé esto caminando, hazme caso porfa', [memo], { timeoutMs: TURN }).then(acc),
  );
  await sleep(6_000);
  const afterV = await rowsOf();
  const sucreAfter = afterV.find((r) => /sucre/i.test(JSON.stringify(r)));
  const nightsAfter = sucreAfter?.[nightsKey];
  report.check(
    'the Sucre row\'s nights went null → 4 (the memo\'s actual change of mind) — a REAL db:write, not a "noted!"',
    Number(nightsAfter) === 4,
    `before=${JSON.stringify(sucreBefore?.[nightsKey])} after=${JSON.stringify(nightsAfter)}`,
  );
  await assertTokenInState(report, pod, PROJECT, { fixture: 'voice-memo.mp3', token: 'Churuquella' });
  report.check('the audio was really transcribed (a transcript/audio path ran)', /Churuquella|Sucre/i.test(JSON.stringify(tV.events).slice(0, 200000)), 'transcript reached the turn');

  // A typed Spanish switch, mid-conversation, no warning.
  const tS = await timed('Act XII — the typed Spanish switch', () =>
    thing
      .send('oye, cambié de planes — al final NO voy a Buenos Aires, mejor me quedo más días en El Calafate, sácalo de la lista', { timeoutMs: TURN })
      .then(acc),
  );
  await sleep(6_000);
  const afterS = await rowsOf();
  const baAfter = afterS.find((r) => /buenos aires/i.test(JSON.stringify(r)));
  const baGone = !baAfter || /skip|cancel|removed|dropped|no\b/i.test(JSON.stringify(baAfter));
  report.check(
    'Buenos Aires was really REMOVED/marked skipped in the db (not just acknowledged in chat)',
    baGone,
    baAfter ? JSON.stringify(baAfter).slice(0, 160) : 'row gone',
  );
  const calaAfter = afterS.find((r) => /calafate/i.test(JSON.stringify(r)));
  const up = Number(calaAfter?.[nightsKey] ?? 0) > Number(calaBefore?.[nightsKey] ?? 0);
  report.check(
    'El Calafate\'s nights really went UP',
    up,
    `before=${JSON.stringify(calaBefore?.[nightsKey])} after=${JSON.stringify(calaAfter?.[nightsKey])}`,
  );
  report.check('no eval/typecheck errors on the Spanish turns', tV.errors.length === 0 && tS.errors.length === 0, JSON.stringify([...tV.errors, ...tS.errors]).slice(0, 200));

  // …and English still routes afterward (no degradation from the language switch).
  const tE = await timed('Act XII — back to English', () =>
    thing.send('ok cool. and what\'s the very next thing i need to actually book?', { timeoutMs: TURN }).then(acc),
  );
  report.check('the next ENGLISH message still routes correctly (no degradation)', (tE.lastText ?? '').length > 20 && tE.errors.length === 0, (tE.lastText ?? '').slice(0, 160));
  cp.acts.XII = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT XIII — pod restart → auto-resume mid-trip ═════════════════════════════
if (ACTS.includes(13)) {
  report.step(
    'Act XIII — Her pod reboots mid-trip and she loses nothing',
    'After POST /api/restart the session auto-resumes, the conversation continues coherently, the weekly cron still fires, and every row written before the restart is still there',
  );
  const rowsBefore = await allRows(pod, PROJECT);
  const countBefore = Object.fromEntries(Object.entries(rowsBefore).map(([k, v]) => [k, v.length]));

  await pod.restart();
  report.check('pod restart issued', true, 'POST /api/restart');
  await sleep(8_000);
  await waitPodReady(user.token).catch(() => {});

  // The resilient send IS the auto-resume edge: it sees the 404, waits, resumes the same session.
  const t = await timed('Act XIII — first turn after the restart', () =>
    thing.send('sorry, where were we — what\'s left on my list?', { timeoutMs: TURN }).then(acc),
  );
  report.check('the session auto-resumed and the conversation continued', (t.lastText ?? '').length > 20, (t.lastText ?? '').slice(0, 180));
  report.check('no eval/typecheck errors after the restart', t.errors.length === 0, JSON.stringify(t.errors).slice(0, 200));

  const rowsAfter = await allRows(pod, PROJECT);
  const countAfter = Object.fromEntries(Object.entries(rowsAfter).map(([k, v]) => [k, v.length]));
  const intact = Object.entries(countBefore).every(([t2, n]) => (countAfter[t2] ?? 0) >= n);
  report.check('every row written before the restart is still there', intact, `${JSON.stringify(countBefore)} → ${JSON.stringify(countAfter)}`);

  // The automations must not go silent after a reboot.
  const cron = cp.facts.cron;
  if (cron?.name) {
    const r = await timed('Act XIII — forced cron run AFTER the restart', () =>
      fireAndTrace(pod, () => pod.runEmitter(PROJECT, cron.scope, cron.name), { settleMs: 600_000 }),
    );
    report.check('the weekly cron still fires after the restart (the automations did not go silent)', !r.res?.error, JSON.stringify(r.res).slice(0, 140));
  } else {
    report.check('the weekly cron still fires after the restart', false, 'no cron recorded (Act VIII did not author one)');
  }
  cp.acts.XIII = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT XIV — Camila's screenshot: readDocument fails, VISION catches it ══════
// Closes coverage gap M. The token lives ONLY in the PNG's pixels — `strings` on the file does not
// contain it and no other fixture mentions it — so a row carrying it is the only honest proof the
// image was LOOKED at rather than plausibly guessed.
if (ACTS.includes(14)) {
  report.step(
    'Act XIV — A screenshot from a friend (readDocument fails on an image → it degrades to vision)',
    'The PNG goes through the vision path; "Red Planet Expedition" (pixels-only) lands in a REAL row; if readDocument was tried on the image, it failed and vision caught it IN THE SAME TURN — the turn still ends clean',
  );
  const shot = await pod.upload(`${FIX}/camila-whatsapp-uyuni.png`);
  report.check('camila-whatsapp-uyuni.png uploaded (kind=image)', shot.kind === 'image' && /png/.test(shot.mediaType ?? ''), `${shot.kind} / ${shot.mediaType}`);

  const t = await timed('Act XIV — the screenshot turn', () =>
    thing
      .sendWithAttachments(
        'camila sent me this and i cba to type it all out, what is she actually telling me to do?? just put it wherever it needs to go',
        [shot],
        { timeoutMs: TURN },
      )
      .then(acc),
  );

  // The vision path was reached (a system-vision delegate, or an image-bearing yield).
  const sawVision = thing.didDelegate('system-vision') || t.delegates.some((d) => /vision/i.test(d)) || t.yields.some((y) => /vision|image/i.test(y.kind));
  report.check('the screenshot went through the VISION path (it was looked at, not opened as text)', sawVision, t.delegates.join(', ') || 'no delegates');

  // The DEGRADATION, asserted rather than assumed. readDocument is documented to fail on an image.
  // If the agent reached for it, the trace must show it FAILING and vision following in the SAME
  // turn. If it never reached for it (it routed straight to vision), that is also correct — record
  // which happened, and never fail the Act for taking the right path first time.
  const rdYields = t.yields.filter((y) => y.kind === 'readDocument');
  const rdResolved = t.events.filter((e) => e.type === 'yield_resolved' && e.kind === 'readDocument');
  const rdFailed = rdResolved.filter((e) => {
    const v = JSON.stringify(e.value ?? e.result ?? '');
    return /error|unsupported|cannot|not a|fail|ok"?:\s*false/i.test(v);
  });
  if (rdYields.length) {
    report.check(
      'readDocument WAS tried on the image and FAILED (the documented behaviour), and vision still caught the turn',
      rdFailed.length > 0 && sawVision,
      `${rdYields.length} readDocument yield(s), ${rdFailed.length} failed; vision=${sawVision}`,
    );
    report.note('The wrong-tool-for-the-media-type path WAS exercised: readDocument was reached for on a PNG, failed, and the turn recovered via vision — exactly the degradation the runtime promises.');
  } else {
    report.note('readDocument was never reached for on the image — the dispatcher routed straight to vision. The right path first time is not a failure; the degradation edge simply did not trigger this run.');
  }
  report.metric('Act XIV — readDocument attempts on the image', rdYields.length);

  // The only proof that survives a guessing model: the pixels-only token, in real state.
  await assertTokenInState(report, pod, PROJECT, { fixture: 'camila-whatsapp-uyuni.png', token: 'Red Planet Expedition' });

  report.check('the turn ended clean (no unrecovered error)', thing.unrecoveredErrors().length === 0, `${t.errors.length} recovered error(s) this turn`);
  cp.acts.XIV = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT XV — a LIVE column migration that must not eat her rows ═══════════════
// Closes coverage gaps L (db.addColumn / live schema migration) and O (schema reconcile:
// additive-OK vs non-additive fail-loud). Adding a column to a table that already holds data is the
// most ordinary thing a growing app does — and losing the rows while doing it is the worst outcome
// in this whole document.
if (ACTS.includes(15)) {
  report.step(
    'Act XV — "which of these have I actually paid for?" — a live migration that keeps her rows',
    'The paid/not-paid column is added to the EXISTING money table live; every pre-existing row id survives; the two lines she named are paid; the app still builds. Then a NON-additive change (an existing column retyped under live rows) must FAIL LOUD, not silently drop data',
  );
  const before = await allRows(pod, PROJECT);
  const money = tableNamed(before, /budget|cost|expense|money|spend/i) ?? cp.facts.itinTable ?? tableNamed(before, /itinerar/i);
  const beforeRows = money ? before[money] : [];
  const idOf = (r) => r.id ?? r.rowId ?? r._id ?? JSON.stringify(r);
  const beforeIds = new Set(beforeRows.map(idOf));
  report.check('there is a money table with rows to migrate (the premise of the Act)', !!money && beforeRows.length > 0, `${money ?? '(none)'}: ${beforeRows.length} rows`);

  const t = await timed('Act XV — the paid/not-paid turn', () =>
    thing
      .send(
        "i keep forgetting which of this stuff i've actually paid for and which i just wrote down. can you put some kind of paid / not-paid thing on each of the money lines? the machu picchu ticket and the brazil visa are both already paid",
        { timeoutMs: TURN },
      )
      .then(acc),
  );

  const after = await allRows(pod, PROJECT);
  const afterRows = money ? (after[money] ?? []) : [];
  const afterIds = new Set(afterRows.map(idOf));

  // THE load-bearing assertion: an additive migration must not lose a single row.
  const lost = [...beforeIds].filter((i) => !afterIds.has(i));
  report.check(
    'ANTI-EXPECTATION: the live migration LOST NO ROWS — every pre-existing row id is still there',
    lost.length === 0 && afterRows.length >= beforeRows.length,
    `${beforeRows.length} → ${afterRows.length} rows; ${lost.length} lost${lost.length ? ': ' + JSON.stringify(lost.slice(0, 3)) : ''}`,
  );

  // The new column exists — on the rows, and in the schema the app compiles against.
  const paidKeyOf = (r) => Object.keys(r).find((k) => /paid|settled/i.test(k));
  const paidKey = afterRows.map(paidKeyOf).find(Boolean);
  report.check('a paid/not-paid column now exists on the money table', !!paidKey, paidKey ?? `columns: ${Object.keys(afterRows[0] ?? {}).join(', ')}`);

  const truthy = (v) => v === true || v === 1 || /^(true|yes|paid|1)$/i.test(String(v ?? ''));
  const paidRows = afterRows.filter((r) => paidKey && truthy(r[paidKey]));
  const named = (rx) => afterRows.find((r) => rx.test(JSON.stringify(r)));
  const mp = named(/machu\s*picchu/i);
  const visa = named(/brazil.*visa|visa.*brazil|e-?visa/i);
  report.check(
    'the two lines she NAMED are marked paid — and only the ones she named',
    !!paidKey && !!mp && !!visa && truthy(mp[paidKey]) && truthy(visa[paidKey]) && paidRows.length < afterRows.length,
    `paid: ${paidRows.length}/${afterRows.length}; machu picchu=${mp ? truthy(mp[paidKey]) : 'no row'}; brazil visa=${visa ? truthy(visa[paidKey]) : 'no row'}`,
  );

  const rebuild = await pod.appBuild(PROJECT).catch((e) => ({ built: false, error: String(e) }));
  report.check('the app still builds after the live migration', rebuild?.built === true, JSON.stringify({ built: rebuild?.built, error: rebuild?.error }).slice(0, 160));

  // ── the NON-additive half: a destructive change must fail LOUD, never silently ───────────────
  // Retype an existing column under live rows. A quiet success here is data loss wearing a green tick.
  const schemaFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/database/.*\\.json$`));
  const schemaPath = schemaFiles.find((f) => money && f.includes(money)) ?? schemaFiles[0];
  if (!schemaPath) {
    report.check('the table has a schema file on disk to force a non-additive change against', false, `no ${PROJECT}/database/*.json found: ${schemaFiles.join(', ') || 'none'}`);
  } else {
    const raw = await pod.readFile(schemaPath);
    const original = typeof raw === 'string' ? raw : (raw?.content ?? '');
    let mutated = null;
    let victim = null;
    try {
      const schema = JSON.parse(original);
      const cols = schema.columns ?? schema.fields ?? schema.schema ?? null;
      // Find a non-id column carrying a type we can flip to an incompatible one.
      const flip = (ty) => (/int|number|float|real|decimal/i.test(ty) ? 'text' : 'integer');
      if (Array.isArray(cols)) {
        const c = cols.find((x) => !/^id$/i.test(x.name ?? x.column ?? '') && (x.type ?? x.dataType));
        if (c) {
          victim = `${c.name ?? c.column}: ${c.type ?? c.dataType} → ${flip(c.type ?? c.dataType)}`;
          if (c.type) c.type = flip(c.type); else c.dataType = flip(c.dataType);
          mutated = JSON.stringify(schema, null, 2);
        }
      } else if (cols && typeof cols === 'object') {
        const k = Object.keys(cols).find((x) => !/^id$/i.test(x));
        if (k) {
          const cur = typeof cols[k] === 'string' ? cols[k] : (cols[k]?.type ?? '');
          victim = `${k}: ${cur} → ${flip(cur)}`;
          if (typeof cols[k] === 'string') cols[k] = flip(cur); else cols[k].type = flip(cur);
          mutated = JSON.stringify(schema, null, 2);
        }
      }
    } catch (e) {
      report.note(`Act XV: could not parse ${schemaPath} as JSON to force the non-additive change (${String(e).slice(0, 80)}) — the destructive half was NOT exercised, and that is reported, not hidden.`);
    }
    if (!mutated) {
      report.check('a non-additive change could be forced against the schema (the destructive half)', false, `schema shape at ${schemaPath} not recognised — destructive half NOT exercised (see note)`);
    } else {
      await pod.writeFile(schemaPath, mutated);
      const bad = await pod.appBuild(PROJECT).then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e: String(e) }));
      const failedLoud =
        bad.ok === false ||
        bad.r?.built === false ||
        !!bad.r?.error ||
        /reconcile|non-additive|type|incompatible|drop/i.test(JSON.stringify(bad.r ?? {}));
      report.check(
        'ANTI-EXPECTATION: the NON-additive change (a live column retyped) FAILS LOUD — it does not silently drop the column\'s data',
        failedLoud,
        `${victim} ⇒ ${JSON.stringify(bad.ok ? bad.r : bad.e).slice(0, 200)}`,
      );
      // Revert — the rest of the scenario runs on this table.
      await pod.writeFile(schemaPath, original);
      const good = await pod.appBuild(PROJECT).catch((e) => ({ built: false, error: String(e) }));
      const reverted = await allRows(pod, PROJECT);
      const revertedRows = money ? (reverted[money] ?? []) : [];
      report.check(
        'after reverting the schema the app builds again and every row is intact',
        good?.built === true && revertedRows.length >= afterRows.length,
        `built=${good?.built}; ${afterRows.length} → ${revertedRows.length} rows`,
      );
    }
  }
  cp.acts.XV = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ ACT XVI — the auto-fill hook that watches the table it writes: THE LOOP GUARD ═══
// Closes coverage gap P. "Just fill it in for me whenever I add one" NATURALLY compiles to a hook
// that subscribes to a write on a table and then writes that same table — the exact self-trigger
// shape `shouldFireHook` exists to stop (`reason:'self-write'` when originatingHookSlug === hook.slug;
// HOOK_DEPTH_CAP = 3). No scenario had ever put a real agent-authored hook into that shape and
// watched. A runaway here burns a real user's budget overnight.
if (ACTS.includes(16)) {
  report.step(
    'Act XVI — "just fill the cost in when i add a stop" — the LOOP GUARD holds',
    'The authored hook subscribes to a write on the itinerary table AND writes that same table. Adding a real stop fills its cost ONCE: hook-triggered sessions stay bounded (≤ HOOK_DEPTH_CAP), rows do not explode, the pod is still responsive',
  );
  const t = await timed('Act XVI — the auto-fill turn', () =>
    thing
      .send(
        "also — every time i add a new stop i forget to put what it's going to cost me, and then the total is a lie. can you just fill in a rough cost for me whenever i add one?",
        { timeoutMs: TURN },
      )
      .then(acc),
  );
  report.check('THING authored an event/hook for it (a write yield, not just a promise)', t.yields.some((y) => /writeProject(Hook|Event)|emitEvent/i.test(y.kind)) || t.delegates.some((d) => /appbuilder|automator/i.test(d)), `${t.yields.map((y) => y.kind).join(', ')} | ${t.delegates.join(', ')}`);

  const itinTable = cp.facts.itinTable ?? tableNamed(await allRows(pod, PROJECT), /itinerar|leg|route|trip|destination|stop/i);

  // The hook must actually be in the self-trigger shape — otherwise the loop guard is never under
  // test and a green tick here would be meaningless.
  const hookFiles = await lsFiles(pod, new RegExp(`^${PROJECT}/(hooks|events)/`));
  let selfTrigger = null;
  for (const f of hookFiles) {
    const raw = await pod.readFile(f).catch(() => null);
    const body = typeof raw === 'string' ? raw : (raw?.content ?? '');
    if (!body || !itinTable) continue;
    const listens = new RegExp(`db\\.${itinTable}\\.|['"\`]${itinTable}['"\`]`).test(body) && /insert|create|update|write|\.on|event|trigger/i.test(body);
    const writes = new RegExp(`db\\.(update|insert|write)|writeProject|['"\`]${itinTable}['"\`]`).test(body);
    if (listens && writes) selfTrigger = f;
  }
  report.check(
    'the hook is in the SELF-TRIGGER shape (it listens to the itinerary table AND writes it) — the loop guard is genuinely under test',
    !!selfTrigger,
    selfTrigger ?? `no self-writing hook among: ${hookFiles.join(', ') || 'none'}`,
  );

  // Now add a real stop, in her own words, and watch what the hook does.
  const rowsBefore = (await allRows(pod, PROJECT))[itinTable] ?? [];
  const sessionsBefore = new Set(await sessionIds(pod));

  const tAdd = await timed('Act XVI — she adds a stop (the hook trigger)', () =>
    thing.send("oh and i've decided to squeeze valparaiso in on the way up the chilean coast, 3 nights, stick it on the list", { timeoutMs: TURN }).then(acc),
  );

  // Let any cascade settle. If the loop guard is broken, THIS is where it runs away.
  await sleep(60_000);

  const rowsAfter = (await allRows(pod, PROJECT))[itinTable] ?? [];
  const sessionsAfter = (await sessionIds(pod)).filter((i) => !sessionsBefore.has(i));

  const valpo = rowsAfter.find((r) => /valpara[ií]so/i.test(JSON.stringify(r)));
  const costKey = valpo ? Object.keys(valpo).find((k) => /cost|price|budget|amount|estimate|spend/i.test(k)) : null;
  const costFilled = valpo && costKey && valpo[costKey] !== null && valpo[costKey] !== undefined && valpo[costKey] !== '' && valpo[costKey] !== 0;
  report.check('the new stop landed, and its cost was FILLED IN for her (the hook actually fired)', !!costFilled, valpo ? `${costKey ?? 'no cost column'} = ${JSON.stringify(valpo[costKey ?? ''])} · ${JSON.stringify(valpo).slice(0, 140)}` : 'no Valparaíso row');

  // THE loop-guard assertion. A hook that re-triggered itself would spawn a session per cascade
  // level until the depth cap — and a BROKEN guard spawns them without end.
  const bounded = sessionsAfter.length <= 3; // HOOK_DEPTH_CAP
  report.check(
    'ANTI-EXPECTATION: the hook did NOT re-trigger itself — hook-triggered sessions stayed bounded (loop guard: self-write / HOOK_DEPTH_CAP=3)',
    bounded,
    `${sessionsAfter.length} new session(s) after the insert (cap 3) — a runaway would be unbounded`,
  );
  const exploded = rowsAfter.length > rowsBefore.length + 3;
  report.check(
    'the itinerary rows did not explode (no write storm from a self-triggering hook)',
    !exploded,
    `${rowsBefore.length} → ${rowsAfter.length} rows`,
  );
  const alive = await pod.listProjects().then(() => true).catch(() => false);
  report.check('the pod is still responsive afterwards (the cascade did not starve it)', alive, alive ? 'GET /api/projects → 200' : 'pod unreachable');
  report.metric('Act XVI — hook-triggered sessions after one insert', sessionsAfter.length);

  report.check('no unrecovered errors across the auto-fill Act', thing.unrecoveredErrors().length === 0, `${tAdd.errors.length} recovered on the add turn`);
  cp.acts.XVI = { passed: report.stepPassed };
  saveCheckpoint(cp);
}

// ═══ whole-session invariants ═════════════════════════════════════════════════
const stats = thing.stats();
report.step(
  'Whole-session invariants',
  'ZERO unrecovered eval/typecheck errors (hard fail); recovered ones are a metric, never hidden',
);
// A recovered error = the loop retried and the deliverable still landed. An UNRECOVERED one is a
// statement the agent NEVER GOT PAST — it exhausted the retry budget (attempt >= MAX_RETRIES).
// That is what `thing.unrecoveredErrors()` measures, and it is the only kind that fails the run.
//
// This check used to count `turn_end.reason =~ /error|fail/` instead, which was wrong BOTH ways:
//   · it counted `stream_error` — an LLM PROVIDER TRANSPORT failure, not an eval/typecheck error —
//     as unrecovered, even though the runtime immediately re-issued the llm_request and recovered
//     (three fired at the same millisecond across concurrent delegates on a live run: a provider
//     hiccup, not an agent defect). A false FAIL.
//   · it never looked at the retry budget at all, so a statement the agent truly never got past was
//     INVISIBLE to it. On that same run it missed 4 real ones.
// Accurate now, and strictly stronger.
const errs = thing.events.filter((e) => e.type === 'eval_error' || e.type === 'typecheck_error');
const byStatement = new Map();
for (const e of errs) byStatement.set(e.statement ?? e.message, (byStatement.get(e.statement ?? e.message) ?? 0) + 1);
const unrec = thing.unrecoveredErrors();
report.check(
  'zero UNRECOVERED eval/typecheck errors across the session (hard check — retry budget exhausted)',
  unrec.length === 0,
  unrec.length ? `${unrec.length} exhausted the retry budget: ${unrec.slice(0, 3).map((e) => String(e.message).slice(0, 60)).join(' | ')}` : `0 (of ${errs.length} total, all retried away)`,
);
report.metric('recovered eval/typecheck errors', errs.length - unrec.length);
report.metric('UNRECOVERED eval/typecheck errors', unrec.length);
if (errs.length) report.note(`Recovered errors (retried, deliverable still landed): ${[...byStatement.keys()].slice(0, 5).map((s) => String(s).slice(0, 90)).join(' | ')}`);

// Provider transport failures are real and worth reporting — but they are NOT eval/typecheck errors
// and a RECOVERED one must not fail the scenario. A stream_error immediately followed by a fresh
// llm_request is the runtime retrying; that is the system working, not breaking.
const streamErrs = thing.events.filter((e) => e.type === 'turn_end' && /stream_error/i.test(String(e.reason)));
report.metric('LLM provider stream errors (transport — retried by the runtime)', streamErrs.length);
if (streamErrs.length) {
  report.note(
    `${streamErrs.length} LLM stream error(s) — provider transport, in: ${[...new Set(streamErrs.map((e) => e.context ?? '?'))].slice(0, 3).join(', ')}. ` +
      'The runtime re-issued the request and the deliverables still landed, so these are reported, not failed on. They are NOT eval/typecheck errors.',
  );
}
report.metric('wall clock', ((now() - t0) / 60_000).toFixed(1), ' min');
report.metric('total tokens (in/out)', `${metrics.tokens.in} / ${metrics.tokens.out}`);
report.metric('delegates', [...new Set(stats.delegates)].join(', ') || 'none');
report.metric('yield kinds', stats.yieldKinds.join(', '));

report.save(`${RESULTS}/report.md`);
report.saveTrace(`${RESULTS}/trace.json`, thing);
cp.done = true;
cp.summary = report.summary();
saveCheckpoint(cp);
console.log(JSON.stringify(report.summary(), null, 2));
clearInterval(keepalive);
process.exit(report.passed ? 0 : 1);

#!/usr/bin/env node
/**
 * Scenario runner TEMPLATE — copy this to `sdk/org/scenarios/<id>/run.mjs` and fill in the Acts.
 * It bakes in every hardening pattern the campaigns learned the hard way (see ../PLAYBOOK.md §1 and
 * ../SCENARIO-FORMAT.md §4): per-Act checkpointing + resume, a keepalive pinger, a resilient `send`
 * that survives a full pod restart, a scripted ask answerer, attachment + live-app + inbound helpers,
 * and trace-based assertions.
 *
 * NOTE: `ThingSession` now self-heals SESSION EVICTION natively (a long turn's sub-sessions can push
 * a small pod past MAX_SESSIONS): pullEvents treats a post-work 404 as turn-complete, and it
 * re-establishes an evicted session before the next send. The `thing.send` wrapper below is the extra
 * belt for a FULL pod roll/restart. For a session-heavy scenario, also raise the cap on the test pod:
 *   ssh … 'kubectl set env deployment/lmthing MAX_SESSIONS=25 -n user-<id>'
 *
 *   cd sdk/org/scenarios/harness && node ../<id>/run.mjs [--acts=1,2,3] [--fresh]
 *
 * Replace every `SCENARIO_*` below, then write your Acts where marked.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { getUser } from '../harness/provision.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';
import { mergePodEnv, waitPodReady, waitPodSettled } from '../harness/lib/gateway.mjs';
import { SDK_ORG } from '../harness/lib/paths.mjs';

// ── config — EDIT THESE ─────────────────────────────────────────────────────────
const ID = 'SCENARIO_ID'; // e.g. '06-something'
const TITLE = 'SCENARIO_TITLE';
const LABEL = 'SCENARIO_LABEL'; // provision.mjs label (disposable user prefix)
const PROJECT = 'SCENARIO_PROJECT'; // the project id the scenario runs in ('user' = default)
/** Any integration/env secrets the scenario needs, loaded BEFORE the first session. */
const POD_ENV = {
  // INTEGRATION_DEMO_BASE_URL: 'https://httpbin.org/anything',
  // INTEGRATION_DEMO_API_TOKEN: 'demo-token',
  // INTEGRATION_DEMO_WEBHOOK_SECRET: 'demo-hmac-secret',
};

const RESULTS = `${SDK_ORG}/scenarios/results`;
const CHECKPOINT = `${RESULTS}/${ID}-checkpoint.json`;
const argActs = (process.argv.find((a) => a.startsWith('--acts=')) ?? '').slice(7);
const ACTS = argActs ? argActs.split(',').map(Number) : [1, 2, 3, 4];
const FRESH = process.argv.includes('--fresh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ── checkpoint (resume from the last good Act) ──────────────────────────────────
function loadCheckpoint() {
  if (FRESH || !existsSync(CHECKPOINT)) return { acts: {}, sessionId: null };
  try { return JSON.parse(readFileSync(CHECKPOINT, 'utf8')); } catch { return { acts: {}, sessionId: null }; }
}
function saveCheckpoint(cp) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2));
  console.log(`\n💾 checkpoint → ${CHECKPOINT}`);
}

// ── scripted asks: approve/deny consent, settle any other ask so a run never hangs ──
const scriptedOnAsk = (consent) => (d) => {
  if (d?.type === 'ConsentCard') return consent;
  if (d?.type) return {}; // settle Forms/other asks with an empty submission
  return undefined;
};

// ── signed inbound helper (a provider-shaped, HMAC-signed webhook to the pod) ────
function signedInbound(pod, path, body, secret, header = 'x-demo-signature') {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return pod.inbound(path, raw, { [header]: sig });
}

// ── project-app assertion helper (build + read real rows) ────────────────────────
// A real live-project app: compile it and confirm real assets came out, then read its DB rows.
// (`built` lives at manifest.build.built and only reflects the LAST compile — so build explicitly
//  and read the POST result, which carries assetManifest + routes. See SCENARIO-FORMAT §4 gotchas.)
async function assertLiveApp(report, pod, projectId, { minRowTables = {} } = {}) {
  const build = await pod.appBuild(projectId).catch((e) => ({ built: false, error: String(e) }));
  const assets = build?.assetManifest ?? [];
  report.check('app compiles (built:true) with real JS assets', build?.built === true && assets.some((a) => /\.js$/.test(a)), JSON.stringify({ built: build?.built, assets }).slice(0, 200));
  report.check('app serves ≥1 page route', (build?.routes?.length ?? 0) >= 1, (build?.routes ?? []).map((x) => x.routePath).join(', '));
  const page = await pod.appPage(projectId).catch((e) => ({ status: 0, body: String(e) }));
  report.check(`/app/${projectId}/ serves 200 HTML`, page.status === 200 && String(page.body).includes('<!doctype'), `status ${page.status}, ${String(page.body).length} bytes`);
  // minRowTables: { <table-regex>: <min rows> } — assert real data landed (moved into the db).
  const manifest = await pod.appManifest(projectId).catch(() => ({}));
  const names = (manifest?.tables ?? []).map((t) => (typeof t === 'string' ? t : t.name));
  for (const [rx, min] of Object.entries(minRowTables)) {
    const t = names.find((n) => new RegExp(rx, 'i').test(n));
    const rows = t ? (await pod.appData(projectId, t).catch(() => ({ rows: [] }))).rows ?? [] : [];
    report.check(`table /${rx}/ has ≥${min} rows`, rows.length >= min, `${t ?? '(none)'}: ${rows.length} rows`);
  }
  return build;
}

// ── main ────────────────────────────────────────────────────────────────────────
const report = new Report(ID, TITLE);
const cp = loadCheckpoint();
const t0 = now();

const user = await getUser(LABEL);
console.log(`user ${user.email} (${user.userId}) → ${user.pod}`);

const { changed } = await mergePodEnv(user.token, POD_ENV);
if (changed) { await waitPodReady(user.token); await waitPodSettled(user.token); }

const pod = new Pod({ base: user.pod, token: user.token });
const projects = await pod.listProjects();
if (PROJECT !== 'user' && !(projects.projects ?? []).some((p) => (p.id ?? p) === PROJECT)) {
  await pod.createProject(PROJECT);
}
cp.projectId = PROJECT;
cp.user = { label: LABEL, email: user.email, userId: user.userId };

const thing = new ThingSession(pod, { projectId: PROJECT, onAsk: scriptedOnAsk(true), verbose: true });
if (cp.sessionId && !FRESH) {
  try { await thing.resume(cp.sessionId); } catch { cp.sessionId = await thing.start(); }
} else {
  cp.sessionId = await thing.start();
}
saveCheckpoint(cp);

// keep the pod warm so an idle scale-to-zero never kills the session mid-run
const keepalive = setInterval(() => {
  pod.req('POST', '/api/keepalive', {}).catch(() => pod.req('POST', '/api/compute/wake', {}).catch(() => {}));
}, 30_000);
keepalive.unref?.();

// resilient send: survive a pod roll/restart (also exercises the auto-resume edge)
const _send = thing.send.bind(thing);
thing.send = async (content, opts = {}) => {
  for (let attempt = 0; ; attempt++) {
    try { return await _send(content, opts); }
    catch (e) {
      const msg = String(e?.body?.error ?? e?.message ?? '');
      const lost = e?.status === 404 || /unknown session|404/.test(msg);
      const errored = /entered error state/.test(msg);
      if ((!lost && !errored) || attempt >= 3) throw e;
      await waitPodReady(user.token).catch(() => {});
      for (let i = 0; i < 40; i++) { if (await pod.listProjects().then(() => true).catch(() => false)) break; await sleep(4_000); }
      if (lost && !errored) { try { await thing.resume(cp.sessionId); continue; } catch { /* fresh */ } }
      cp.sessionId = await thing.start(); saveCheckpoint(cp);
    }
  }
};

const metrics = { tokens: { in: 0, out: 0 } };
const acc = (turn) => { metrics.tokens.in += turn.tokens.in; metrics.tokens.out += turn.tokens.out; return turn; };

// ═══ ACT I ════════════════════════════════════════════════════════════════════
if (ACTS.includes(1)) {
  report.step('Act I — <name>', '<the contract this Act asserts>');
  const t = acc(await thing.send('<the user message>', { timeoutMs: 900_000 }));
  report.check('no eval/typecheck errors', t.errors.length === 0, JSON.stringify(t.errors).slice(0, 200));
  // report.check('delegated to <space>', thing.didDelegate('<space>'), t.delegates.join(', '));
  // ...assert on the trace + real side effects (files/rows/spaces), not the prose...
  cp.acts.I = { passed: report.passed };
  saveCheckpoint(cp);
}

// ═══ ACT II / III / IV — same shape; gate each on ACTS.includes(n) + checkpoint ═══
// (Toggle scripted consent for a deny branch: thing.onAsk = scriptedOnAsk(false); ... reset to true.)
//
// ── Example: a file attachment → a live app with the data seeded in (the S06 pattern) ──
// const attachment = await pod.upload(`${SDK_ORG}/scenarios/${ID}/fixtures/notes.md`);
// report.check('file uploaded (kind=file)', attachment.kind === 'file', attachment.mediaType);
// // Attachments ride the WS path (HTTP /message drops them). THING hands the file to a specialist
// // via attachmentIds; the automator readDocument()s it and seeds rows via writeProjectTable(...,rows).
// const t = acc(await thing.sendWithAttachments('<the user message>', [attachment], { timeoutMs: 1_500_000 }));
// report.check('read the file (system-files)', thing.didDelegate('system-files'), t.delegates.join(', '));
// await assertLiveApp(report, pod, PROJECT, { minRowTables: { 'flight|itinerary': 5, 'accommodation|hotel': 6 } });
//
// ── Example: a LATER update changes the db (use a NEW fact NOT already in any seed) ──
// const before = JSON.stringify(await pod.appData(PROJECT, '<table>').catch(() => ({})));
// acc(await thing.send('Mark X as done and record confirmation "NEW-TOKEN-123".', { timeoutMs: 900_000 }));
// await sleep(4_000);
// const after = JSON.stringify(await pod.appData(PROJECT, '<table>').catch(() => ({})));
// report.check('the NEW fact landed in the db', !before.includes('new-token-123') && after.toLowerCase().includes('new-token-123'), 'before/after diff');
//
// ── Example: a signed inbound webhook fires a code-handler hook (0 LLM) ──
// const res = await signedInbound(pod, 'demo', { message: { message_id: 1, text: 'TIP: hello', chat: { id: 'c1' }, from: { id: 'u1' } } }, POD_ENV.INTEGRATION_DEMO_WEBHOOK_SECRET);
// report.check('inbound accepted (verify→emit)', res.status === 200 && res.body?.events >= 1, JSON.stringify(res.body));

// ═══ verdict ══════════════════════════════════════════════════════════════════
const stats = thing.stats();
report.step('Whole-session invariants', 'no eval/typecheck errors; routing not degraded over the run');
report.check('zero eval/typecheck errors across the session', stats.errors === 0, `${stats.errors} errors`);
report.metric('wall clock', ((now() - t0) / 60_000).toFixed(1), ' min');
report.metric('total tokens (in/out)', `${metrics.tokens.in} / ${metrics.tokens.out}`);

report.save(`${RESULTS}/${ID}-report.md`);
report.saveTrace(`${RESULTS}/${ID}-trace.json`, thing);
cp.done = true; cp.summary = report.summary(); saveCheckpoint(cp);
console.log(JSON.stringify(report.summary(), null, 2));
process.exit(report.passed ? 0 : 1);

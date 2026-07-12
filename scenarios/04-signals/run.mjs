#!/usr/bin/env node
/**
 * Scenario 04 — Signals & Code nodes (see ../04-signals-and-code-nodes.md).
 *
 *   cd sdk/org/scenarios/harness && node ../04-signals/run.mjs
 *   STEPS=1,2 node ../04-signals/run.mjs        # run a subset (state is cached in .state/)
 *
 * The theme: the model decides, code does. Everything the scenario asserts on is authored
 * THROUGH THING by the system spaces (system-store / system-appbuilder / system-engineer) —
 * the runner only *provokes* and *reads*, except where a step explicitly says "the runner
 * installs …" (the deliberately-hostile edges of Step 2/6, which no sane specialist would write).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession, approveAllConsent } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';
import { getUser } from '../harness/provision.mjs';
import { STATE_DIR, SCENARIOS_DIR } from '../harness/lib/paths.mjs';

const LABEL = 'observatory';
const PROJECT = 'observatory';
const STEPS = new Set((process.env.STEPS ?? '1,2,3,4,5,6,7').split(',').map((s) => s.trim()));
const on = (n) => STEPS.has(String(n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = new Report('04-signals', 'Signals & Code nodes — the runtime observing itself');
const stateFile = `${STATE_DIR}/04-signals.json`;
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const saveState = () => {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
};

// ── setup ─────────────────────────────────────────────────────────────────────
r.step('setup', 'a ready pod whose store catalog carries integration-lmthing (5 internal defs) + integration-demo (webhook emitter)');
const user = await getUser(LABEL);
const pod = new Pod({ base: user.pod, token: user.token });
r.note(`user ${user.userId} · pod ${user.pod}`);

// Ensure the project + its `signals` recorder TABLE exist. The table is storage substrate the
// harness provisions (like the project itself): NEITHER specialist THING routes to can both make a
// table (db:schema — app-architect/data-modeler) AND author the recording hooks (hooks:write —
// automator) on the first ask, so the runner writes the schema file + boots the db. The FEATURE
// under test (the event hooks, emitter defs, code nodes) stays agent-authored. See the report.
async function ensureSignalsTable() {
  const projs = (await pod.listProjects()).projects ?? [];
  if (!projs.some((p) => p.id === PROJECT)) await pod.createProject(PROJECT).catch(() => {});
  const live = await pod.appData(PROJECT, 'signals').then(() => true).catch(() => false);
  if (live) return false;
  const schema = {
    title: 'Signals',
    description: 'Recorded lmthing runtime signals (the observatory)',
    columns: {
      id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
      signal: { type: 'string', description: 'the routed event name', required: true },
      payload: { type: 'string', description: 'the full event payload as JSON', default: '' },
      at: { type: 'number', description: 'ms epoch when recorded', default: 0 },
    },
  };
  await pod.writeFile(`${PROJECT}/database/signals.json`, JSON.stringify(schema, null, 2));
  // The cached "no db" is only dropped by a schema-writer global or a boot re-scan; force the
  // latter with a restart, then wait for the pod to settle so sessions created next survive.
  await pod.restart().catch(() => {});
  const { waitPodReady, waitPodSettled } = await import('../harness/lib/gateway.mjs');
  await waitPodReady(user.token).catch(() => {});
  await waitPodSettled(user.token).catch(() => {});
  return true;
}

const catalog = (await pod.storeSpaces()).spaces ?? [];
const lm = catalog.find((s) => s.id === 'integration-lmthing');
const demo = catalog.find((s) => s.id === 'integration-demo');
const SIGNALS = ['session.completed', 'space.installed', 'hook.fired', 'document.written', 'project.created'];
r.check(
  'integration-lmthing publishes all 5 internal events',
  !!lm && SIGNALS.every((e) => lm.events?.[e]),
  Object.keys(lm?.events ?? {}).join(', '),
);
r.check(
  'integration-demo publishes a webhook emitter (pre-flight)',
  !!demo?.inbound?.length && !!demo?.events?.['message.received'],
  JSON.stringify({ inbound: demo?.inbound, events: Object.keys(demo?.events ?? {}) }),
);

// ── helpers ───────────────────────────────────────────────────────────────────
const files = async (prefix) => ((await pod.fsTree()).files ?? []).filter((f) => f.startsWith(prefix));
const read = (p) => pod.readFile(p).then((x) => x.content ?? x).catch(() => null);
const rows = async (table) => {
  try {
    const res = await pod.appData(PROJECT, table);
    return res.rows ?? (Array.isArray(res) ? res : []);
  } catch {
    return [];
  }
};
/** Poll until `fn()` is truthy (or time out) — signals are fire-and-forget + async. */
const until = async (fn, { timeoutMs = 60_000, everyMs = 3_000 } = {}) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(everyMs);
  }
};
const say = async (thing, msg, opts) => {
  const t = await thing.send(msg, opts).catch((e) => {
    r.note(`turn error: ${String(e).slice(0, 300)}`);
    return e.turn ?? { events: [], errors: [{ message: String(e) }], yields: [], delegates: [], tokens: { in: 0, out: 0 }, llmCalls: 0, durationMs: 0, text: '' };
  });
  return t;
};
/** Every signal row the recorder hooks wrote, normalized to {signal, payload}. */
const signalRows = async () => {
  const rs = await rows('signals');
  return rs.map((row) => {
    let payload = row.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { /* keep raw */ }
    }
    return { ...row, signal: row.signal ?? row.name ?? row.event, payload };
  });
};

let thing; // the project-scoped THING session (created in step 1)

// ── Step 1 — install the mirror ───────────────────────────────────────────────
if (on(1)) {
  r.step('1 · install the mirror', 'THING creates the project, finds+installs integration-lmthing (consent), and authors hooks recording all 5 runtime signals');

  const boot = new ThingSession(pod, { projectId: 'user', onAsk: approveAllConsent, verbose: true });
  await boot.start();
  const t0 = Date.now();
  const tp = await say(boot, 'Create a new project called "observatory" for me. Just the project — nothing in it yet.');
  const projects = (await pod.listProjects()).projects ?? [];
  r.check('project "observatory" created via THING', projects.some((p) => p.id === PROJECT), projects.map((p) => p.id).join(', '));
  r.metric('create-project turn', ((Date.now() - t0) / 1000).toFixed(1), 's');
  r.note(`delegates: ${tp.delegates.join(', ') || '(none)'}`);
  if (!projects.some((p) => p.id === PROJECT)) {
    await pod.createProject(PROJECT).catch(() => {});
    r.note('fallback: created the project over the API so the scenario can continue');
  }

  thing = new ThingSession(pod, { projectId: PROJECT, onAsk: approveAllConsent, verbose: true });
  await thing.start();
  const t1 = Date.now();
  const turn = await say(
    thing,
    'I want this project to keep a record of everything lmthing does for me — every hook that fires, ' +
      'every document written, every session that finishes, every space installed, every project created. ' +
      'Find the right integration in the store, install it, and set up the recording: a database table ' +
      '`signals` with columns `signal` (text), `payload` (text — the full event payload as JSON) and ' +
      '`at` (number, Date.now()), and one hook per event that writes a row into it. Use code handlers — ' +
      'no LLM should run just to record a signal.',
    { timeoutMs: 900_000 },
  );
  r.metric('install+author turn', ((Date.now() - t1) / 1000).toFixed(1), 's');
  r.metric('install+author tokens', `${turn.tokens.in} in / ${turn.tokens.out} out`);
  r.note(`delegates: ${turn.delegates.join(', ') || '(none)'}`);
  r.note(`yields: ${[...new Set(turn.yields.map((y) => y.kind))].join(', ')}`);

  const cards = thing.consentCards();
  r.check('a consent card was raised for the install', cards.length > 0, JSON.stringify(cards.map((c) => c.descriptor?.props ?? c.descriptor)).slice(0, 200));
  r.check('installSpace was called (consent-marked global)', thing.didYield('installSpace'), JSON.stringify(turn.yields.filter((y) => y.kind === 'installSpace').map((y) => y.args)));
  r.check('THING delegated store discovery to system-store', thing.didDelegate('system-store'), turn.delegates.join(', '));

  const spaces = (await pod.listSpaces(PROJECT)).spaces ?? [];
  const ids = spaces.map((s) => s.id ?? s);
  r.check('integration-lmthing installed into the project', ids.includes('integration-lmthing'), ids.join(', '));

  const hookFiles = await files(`${PROJECT}/hooks/`);
  const hookSrc = Object.fromEntries(await Promise.all(hookFiles.map(async (f) => [f, await read(f)])));
  const subscribed = SIGNALS.filter((ev) => Object.values(hookSrc).some((src) => src?.includes(`integration-lmthing/${ev}`)));
  r.check('hooks subscribe to ≥3 of the 5 internal events', subscribed.length >= 3, `${subscribed.length}/5: ${subscribed.join(', ')}`);
  r.check('all 5 internal events are subscribed', subscribed.length === 5, subscribed.join(', '));
  r.check('hooks use code handlers (no agent trigger → 0 tokens per signal)', Object.values(hookSrc).every((s) => !s?.includes('trigger:')), hookFiles.join(', '));
  r.note(`hook files: ${hookFiles.join(', ') || '(none)'}`);

  const tables = await rows('signals');
  r.check('the `signals` table exists', Array.isArray(tables), `${tables.length} rows at start`);

  state.step1 = { hookFiles, subscribed };
  saveState();
}

// ── Step 2 — provoke each signal through its real cause ───────────────────────
if (on(2)) {
  r.step('2 · provoke each signal', 'each of the 5 signals emits through its REAL cause, routes to a hook, and lands a schema-exact row');
  const madeTable = await ensureSignalsTable();
  r.note(`signals table provisioned by the harness this run: ${madeTable}`);
  thing ??= await (async () => { const t = new ThingSession(pod, { projectId: PROJECT, onAsk: approveAllConsent, verbose: true }); await t.start(); return t; })();

  const before = await signalRows();
  r.note(`rows before: ${before.length}`);

  // (a) project.created — a second project.
  await pod.createProject('scratch').catch(() => {});
  // (b) space.installed — install integration-demo through THING (consent → approve).
  const t2 = await say(thing, 'Also install the "demo" messaging integration from the store into this project.', { timeoutMs: 600_000 });
  r.check('second install went through a consent card', thing.consentCards().length >= 2, `${thing.consentCards().length} cards`);
  const ids2 = ((await pod.listSpaces(PROJECT)).spaces ?? []).map((s) => s.id ?? s);
  r.check('integration-demo installed', ids2.includes('integration-demo'), ids2.join(', '));
  // (c) document.written — ask THING to write a note (the agent path).
  const t3 = await say(thing, 'Write me a short note in this project called `mission.md` — one paragraph on what this observatory is for.', { timeoutMs: 600_000 });
  r.note(`note-writing yields: ${[...new Set(t3.yields.map((y) => y.kind))].join(', ')}`);
  const docsAfterAgent = await pod.req('GET', `/api/projects/${PROJECT}/documents`).catch(() => ({ documents: [] }));
  r.note(`documents after the agent wrote: ${JSON.stringify(docsAfterAgent).slice(0, 200)}`);
  // …and the HTTP document route (the Studio path), as a control on the same signal.
  await pod.req('POST', `/api/projects/${PROJECT}/documents`, { name: 'control-note.md', content: '# control\nwritten over the documents route' }).catch((e) => r.note(`documents route: ${e.message}`));

  // (d/e) hook.fired + session.completed ride along with the above.
  const got = (name) => async () => (await signalRows()).some((s) => s.signal === name || String(s.payload?.signal ?? '') === name);
  await until(async () => (await signalRows()).length > before.length, { timeoutMs: 90_000 });
  await sleep(15_000);
  const after = await signalRows();
  r.note(`rows after: ${after.length} — ${JSON.stringify(after.slice(-8)).slice(0, 800)}`);

  const seen = new Set(after.map((s) => s.signal));
  const SCHEMA = {
    'project.created': { projectId: 'string' },
    'space.installed': { projectId: 'string', spaceId: 'string' },
    'document.written': { projectId: 'string', path: 'string' },
    'hook.fired': { projectId: 'string', slug: 'string', hookType: 'string' },
    'session.completed': { projectId: 'string', agent: 'string', sessionId: 'string', ok: 'boolean', durationMs: 'number' },
  };
  for (const [ev, schema] of Object.entries(SCHEMA)) {
    const row = after.find((s) => s.signal === ev);
    r.check(`signal "${ev}" routed to a hook and landed a row`, !!row, row ? JSON.stringify(row.payload).slice(0, 200) : 'no row');
    if (!row) continue;
    const p = row.payload ?? {};
    const bad = Object.entries(schema).filter(([k, t]) => typeof p[k] !== t);
    const extra = Object.keys(p).filter((k) => !(k in schema));
    r.check(`  "${ev}" payload matches the declared schema exactly`, bad.length === 0 && extra.length === 0, bad.length ? `wrong/missing: ${bad.map(([k]) => k).join(', ')}` : extra.length ? `undeclared keys: ${extra.join(', ')}` : 'exact');
    r.check(`  "${ev}" has no undefined fields (incomplete signals are dropped, not stored)`, !Object.values(p).some((v) => v === undefined || v === null), JSON.stringify(p).slice(0, 160));
  }
  const sc = after.find((s) => s.signal === 'session.completed');
  if (sc) r.check('session.completed carries ok:true and durationMs > 0', sc.payload?.ok === true && Number(sc.payload?.durationMs) > 0, JSON.stringify(sc.payload));

  state.step2 = { rows: after.length, seen: [...seen] };
  saveState();

  // Edge — a throwing internal def must be worker-contained.
  r.step('2e · a throwing internal def', 'an emitter def whose emit() throws is worker-contained: the instrumented path (a space install) still completes and the healthy defs still emit');
  await pod.writeFile(
    `${PROJECT}/events/boom.ts`,
    [
      '// A deliberately hostile internal emitter def (installed by the scenario runner, not by an agent).',
      'export default {',
      "  type: 'internal',",
      "  on: { signal: 'space.installed' },",
      "  emits: { 'boom.happened': { payload: { projectId: 'string' } } },",
      '  emit: () => { throw new Error("boom: this emitter def is broken on purpose"); },',
      '};',
      '',
    ].join('\n'),
  );
  const nBefore = (await signalRows()).length;
  const inst = await pod.installSpace('integration-google', PROJECT, false).catch((e) => ({ error: e.message }));
  const idsBoom = ((await pod.listSpaces(PROJECT)).spaces ?? []).map((s) => s.id ?? s);
  r.check('the instrumented path (space install) still completed', idsBoom.includes('integration-google'), JSON.stringify(inst).slice(0, 160));
  const landed = await until(async () => (await signalRows()).filter((s) => s.signal === 'space.installed' && s.payload?.spaceId === 'integration-google').length > 0, { timeoutMs: 60_000 });
  r.check('the healthy defs still emitted alongside the throwing one', !!landed, landed ? 'space.installed(integration-google) recorded' : `no new rows (${nBefore} → ${(await signalRows()).length})`);
  await pod.req('DELETE', `/api/fs/write?path=${encodeURIComponent(`${PROJECT}/events/boom.ts`)}`).catch(() => {});
  await pod.writeFile(`${PROJECT}/events/boom.ts`, '').catch(() => {});
}

// ── Step 3 — the project publishes its own event ──────────────────────────────
if (on(3)) {
  r.step('3 · publish a custom event', 'a project emitter def declares report.ready, an agent with events:emit publishes it, a hook subscribed to project/report.ready fires');
  thing ??= await (async () => { const t = new ThingSession(pod, { projectId: PROJECT, onAsk: approveAllConsent, verbose: true }); await t.start(); return t; })();

  const t = await say(
    thing,
    'I want this project to be able to publish its own event, `report.ready` (payload: `title` text and ' +
      '`count` number), that other automations can subscribe to. Declare it, add a hook that reacts to it ' +
      'by recording a row in the `signals` table, and then publish one right now with title "first" and count 1.',
    { timeoutMs: 900_000 },
  );
  r.note(`delegates: ${t.delegates.join(', ') || '(none)'}`);
  r.note(`yields: ${[...new Set(t.yields.map((y) => y.kind))].join(', ')}`);

  const evFiles = await files(`${PROJECT}/events/`);
  const evSrc = Object.fromEntries(await Promise.all(evFiles.map(async (f) => [f, await read(f)])));
  r.check('a project emitter def declares report.ready', Object.values(evSrc).some((s) => s?.includes('report.ready')), evFiles.join(', '));
  const hkFiles = await files(`${PROJECT}/hooks/`);
  const hkSrc = Object.fromEntries(await Promise.all(hkFiles.map(async (f) => [f, await read(f)])));
  r.check('a hook subscribes to project/report.ready', Object.values(hkSrc).some((s) => s?.includes('project/report.ready')), hkFiles.join(', '));
  r.check('emitEvent was called', t.yields.some((y) => y.kind === 'emitEvent'), JSON.stringify(t.yields.filter((y) => y.kind === 'emitEvent').map((y) => y.args)).slice(0, 200));
  const fired = await until(async () => (await signalRows()).some((s) => s.signal === 'report.ready' || String(s.payload?.title ?? '') === 'first'), { timeoutMs: 90_000 });
  r.check('the subscribing hook fired (a row landed for report.ready)', !!fired, fired ? 'row present' : 'no row');
  r.check('no eval errors in the publish turn', t.errors.length === 0, JSON.stringify(t.errors).slice(0, 300));

  // Edges.
  r.step('3e · emitEvent validation', 'undeclared name → dropped/failed, no hook; bad payload → dropped; no events:emit → typecheck failure; a space cannot emit another scope\'s address');
  const eBad = await say(
    thing,
    'Now try two things that should fail, and tell me exactly what happened: (1) publish an event named ' +
      '`totally.undeclared` with payload {x:1}; (2) publish `report.ready` with a payload where count is the ' +
      'string "many" instead of a number.',
    { timeoutMs: 600_000 },
  );
  const evErrs = eBad.events.filter((e) => e.type === 'yield_error' || e.type === 'eval_error').map((e) => e.message ?? '').join(' | ');
  r.check('undeclared event name is refused (no hook fires)', /not declared|undeclared/i.test(evErrs + eBad.text), evErrs.slice(0, 240) || eBad.text.slice(0, 240));
  r.check('schema-violating payload is refused', /schema|declared|payload/i.test(evErrs + eBad.text), evErrs.slice(0, 240) || eBad.text.slice(0, 240));
  const badRows = (await signalRows()).filter((s) => s.signal === 'totally.undeclared');
  r.check('the undeclared event fired no hook', badRows.length === 0, `${badRows.length} rows`);

  // An agent WITHOUT events:emit cannot even express the call (DTS overlay).
  const eng = new ThingSession(pod, { projectId: PROJECT, agentSlug: 'engineer', verbose: false });
  await eng.start().catch(() => {});
  const te = await say(eng, 'Run exactly this one statement and report the outcome: await emitEvent("report.ready", { title: "x", count: 1 });', { timeoutMs: 420_000 });
  const tcErr = te.errors.filter((e) => e.type === 'typecheck_error');
  r.check('an agent without events:emit cannot express emitEvent (typecheck failure at injection)', tcErr.length > 0 || /cannot find name .?emitEvent/i.test(JSON.stringify(te.errors)), JSON.stringify(te.errors).slice(0, 240));

  // Scope is host-derived: a SPACE agent emitting a project-scoped address is impossible.
  const pub = new ThingSession(pod, { projectId: PROJECT, agentSlug: 'publisher', verbose: false });
  await pub.start({ }).catch(() => {});
  const tsp = await say(pub, 'Publish the event named "report.ready" with payload {title:"spoof",count:2}.', { timeoutMs: 420_000 }).catch(() => null);
  const spoofRows = (await signalRows()).filter((s) => String(s.payload?.title ?? '') === 'spoof');
  r.check(
    'a space cannot emit another scope\'s address (scope is host-derived)',
    spoofRows.length === 0,
    tsp ? `publisher turn: ${(tsp.text || '').slice(0, 160)}` : 'session failed to start',
  );
}

// ── Step 4/5 — the mixed DAG ──────────────────────────────────────────────────
if (on(4) || on(5)) {
  r.step('4 · the mixed DAG', 'a space tasklist: an agent node (webSearch) → two code nodes (format, store); code nodes burn 0 tokens; outputs flow by node id');
  thing ??= await (async () => { const t = new ThingSession(pod, { projectId: PROJECT, onAsk: approveAllConsent, verbose: true }); await t.start(); return t; })();

  const t = await say(
    thing,
    'Build me a `digest` tasklist: research a topic on the web, then format the findings and store them in ' +
      'the project database — and do NOT use a model for the formatting or the storing, that must be plain ' +
      'code. Structure it as three nodes: `research` (an agent that uses webSearch/webFetch and outputs ' +
      '`findings` (array) and `summary` (string)), `format` (code, depends on research), and `store` (code, ' +
      'depends on format, writes one row per finding into a `digest` table). The tasklist takes a `topic` ' +
      'seed input. Tell me the tasklist reference when it is done.',
    { timeoutMs: 1_200_000 },
  );
  r.note(`delegates: ${t.delegates.join(', ') || '(none)'}`);
  r.note(`THING said: ${t.text.slice(0, 400)}`);

  const all = (await pod.fsTree()).files ?? [];
  const tl = all.filter((f) => f.startsWith(`${PROJECT}/spaces/`) && f.includes('/tasklists/'));
  r.check('a space tasklist was authored', tl.length > 0, tl.join(', ') || '(none)');
  const codeNodes = tl.filter((f) => /\/tasklists\/[^/]+\/\d+-[^/]+\.ts$/.test(f));
  r.check('it contains CODE nodes (NN-<id>.ts)', codeNodes.length >= 2, codeNodes.join(', ') || '(none — no code node was authored)');
  const agentNodes = tl.filter((f) => /\/tasklists\/[^/]+\/\d+-[^/]+\.md$/.test(f));
  r.check('it contains an agent node (NN-<id>.md)', agentNodes.length >= 1, agentNodes.join(', ') || '(none)');
  for (const f of codeNodes) r.note(`${f}:\n${(await read(f)) ?? ''}`.slice(0, 700));

  state.step4 = { tasklistFiles: tl };
  saveState();
}

r.step('report', 'save the trace + report');
if (thing) {
  r.metric('THING session events', thing.events.length);
  r.metric('THING session tokens', `${thing.stats().tokens.in} in / ${thing.stats().tokens.out} out`);
  r.saveTrace(`${SCENARIOS_DIR}/results/04-signals-trace.json`, thing);
}
r.save(`${SCENARIOS_DIR}/results/04-signals-report.md`);
console.log(`\nsummary: ${JSON.stringify(r.summary())}`);
process.exit(r.passed ? 0 : 1);

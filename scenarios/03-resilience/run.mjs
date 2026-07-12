#!/usr/bin/env node
/**
 * Scenario 03 — Resilience: storms, cycles, and a pod restart mid-flight.
 *
 *   cd sdk/org/scenarios/harness && node ../03-resilience/run.mjs [--only 1,2,3] [--fresh]
 *
 * The load target is built THROUGH THING (the hooks are *authored*, not hand-planted); the load
 * itself is generated with direct pod calls — a scenario that measures throughput must not be
 * rate-limited by the thing measuring it.
 *
 * Steps are individually selectable (`--only 2,3`) because a live prod run of the whole thing is
 * ~30 min and the storm is the part you iterate on. Cross-step state (the project id, the session
 * ids) is cached in `.state/03-resilience.json`.
 */
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { getUser } from '../harness/provision.mjs';
import { mergePodEnv, waitPodReady, waitPodSettled, podStatus } from '../harness/lib/gateway.mjs';
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession, approveAllConsent } from '../harness/lib/thing.mjs';
import { Report } from '../harness/lib/report.mjs';
import { STATE_DIR, SDK_ORG } from '../harness/lib/paths.mjs';

// ── config ────────────────────────────────────────────────────────────────────

const LABEL = 'firehose';
const PROJECT = 'firehose';
const SECRET = 'scn03-demo-webhook-secret';
const STORM_TOTAL = 200;
const STORM_SEQUENTIAL = 50;
const STORM_CONCURRENCY = 20;

const args = process.argv.slice(2);
const only = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? new Set(args[i + 1].split(',').map((s) => s.trim())) : null;
})();
const runStep = (n) => !only || only.has(String(n));

const STATE_FILE = `${STATE_DIR}/03-resilience.json`;
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = () => {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// ── inbound signing (the demo emitter's declarative hmac VerifySpec) ──────────

/** `x-demo-signature: sha256=<hex>` over the RAW body — exactly what the pod verifies. */
function sign(raw) {
  return { 'x-demo-signature': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` };
}

/** One demo delivery body (Telegram-ish, per `store/spaces/integration-demo/events/messages.ts`). */
const delivery = (i, text = `storm message number ${i}`) =>
  JSON.stringify({
    message: {
      message_id: i,
      text,
      chat: { id: 'storm' },
      from: { id: 'u1', username: 'ada' },
    },
  });

/** POST one signed delivery straight at the pod; returns {status, ms, body}. */
async function deliver(pod, raw) {
  const t0 = Date.now();
  const res = await pod.inbound('demo', raw, sign(raw));
  return { ...res, ms: Date.now() - t0 };
}

// ── db read helpers (the app-admin data API) ─────────────────────────────────

/** NB: the app-data route defaults to limit=50 — always ask for the whole table. */
async function rows(pod, table, limit = 5_000) {
  try {
    const r = await pod.req('GET', `/api/projects/${PROJECT}/app/data/${table}?limit=${limit}`);
    return r.rows ?? [];
  } catch {
    return [];
  }
}

/** Poll until a table's row count stops changing (the dispatch queue has drained). */
async function settle(pod, table, { quietMs = 6_000, timeoutMs = 180_000 } = {}) {
  const t0 = Date.now();
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = (await rows(pod, table)).length;
    if (n !== last) {
      last = n;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return n;
    }
    await sleep(1_500);
  }
  return last;
}

// ── main ──────────────────────────────────────────────────────────────────────

const report = new Report('03-resilience', 'Resilience — storms, cycles, and a pod restart mid-flight');
const user = await getUser(LABEL);
const pod = new Pod({ base: user.pod, token: user.token });
console.log(`# user ${user.email} (${user.userId})  ns=user-${user.userId}`);
const trace = { user: { email: user.email, userId: user.userId }, steps: {} };

// ── Step 0 — pre-flight: the store catalog + the webhook secret ──────────────
{
  report.step('Step 0 — pre-flight', 'integration-demo ships its webhook emitter def; the pod holds the signing secret');
  const cat = await pod.storeSpaces();
  const demo = (cat.spaces ?? cat).find((s) => s.id === 'integration-demo');
  report.check(
    'store catalog exposes integration-demo inbound demo/hmac',
    demo?.inbound?.some((i) => i.path === 'demo' && i.verify === 'hmac'),
    JSON.stringify(demo?.inbound),
  );
  report.check(
    'store catalog exposes its message.received emitter contract',
    !!demo?.events?.['message.received'],
    Object.keys(demo?.events ?? {}).join(','),
  );

  // The secret must be in pod env BEFORE any session opens: a PUT rolls the pod.
  const { changed } = await mergePodEnv(user.token, { INTEGRATION_DEMO_WEBHOOK_SECRET: SECRET });
  if (changed) {
    console.log('# pod env updated (rolling) — waiting for it to settle');
    await waitPodReady(user.token);
    await waitPodSettled(user.token);
  }
  report.check('webhook signing secret present in pod env', true, changed ? 'written (pod rolled)' : 'already set');
}

// ── Step 1 — build the load target THROUGH THING ─────────────────────────────
//
// THING installs the demo integration (its real job — with a consent card). The
// storage automation is authored INTO THE LIVE PROJECT by system-appbuilder's
// `automator` (the documented live-project authoring agent, `writeProjectHook`) —
// NOT by the app-architect/`build_app` flow, which creates a *catalog* app in the
// pod's cwd and lands nothing in the live project (recorded as a finding). The two
// inert table schemas are scaffolded via the app-files API (they carry no
// loop-guard logic — the HOOK, which does, is the part that must be system-authored).
if (runStep(1)) {
  report.step(
    'Step 1 — build the load target through THING + the automator',
    'THING installs integration-demo (consent); the automator authors a CODE-handler event hook into the live project (no agent in the hot path)',
  );

  const projects = await pod.listProjects();
  if (!(projects.projects ?? projects).some((p) => p.id === PROJECT)) {
    await pod.createProject(PROJECT);
    report.note(`created project "${PROJECT}"`);
  }

  // 1a. THING installs the demo integration (real session, consent card). Idempotent:
  // skip if already installed (a re-run must not trigger a reinstall consent Form).
  const already = ((await pod.listSpaces(PROJECT)).spaces ?? []).some((s) => (s.id ?? s) === 'integration-demo');
  if (already) {
    report.note('integration-demo already installed — skipping the THING install turn');
    report.check('integration-demo installed into the project', true, 'pre-installed');
  } else {
    const thing = new ThingSession(pod, { projectId: PROJECT, onAsk: approveAllConsent, verbose: true });
    await thing.start();
    state.buildSessionId = thing.sessionId;
    saveState();
    const t0 = Date.now();
    const turn = await thing.send(
      `Install the demo integration — the store space with id "integration-demo" — into this project. ` +
        `Just install it; do not build an app or write any files. Confirm when it is installed.`,
      { timeoutMs: 900_000 },
    );
    report.metric('THING install turn', ((Date.now() - t0) / 1000).toFixed(0), 's');
    trace.steps.build = { delegates: turn.delegates, yields: turn.yields.map((y) => y.kind), text: turn.text };
    const ids = ((await pod.listSpaces(PROJECT)).spaces ?? []).map((s) => s.id ?? s);
    report.check('THING installed integration-demo into the project', ids.includes('integration-demo'), ids.join(','));
    report.check('THING raised a consent card for the install', thing.consentCards().length > 0, `${thing.consentCards().length} card(s)`);
  }

  // The deployed integration-demo ships a LEGACY `triggers: - webhook:{path:demo}` on
  // its handler agent ALONGSIDE the new emitter def. resolveBinding checks legacy
  // triggers before emitter defs, so the legacy binding SHADOWS the emitter (inbound
  // deliveries hit an LLM agent instead of the code path). The events-and-hooks skill:
  // "a space must not carry both, or the legacy binding shadows the emitter def." Fixed
  // at source (store/spaces/integration-demo); patch the installed copy here so the
  // emitter path wins on this run (idempotent).
  const handlerPath = `${PROJECT}/spaces/integration-demo/agents/handler/instruct.md`;
  try {
    const cur = (await pod.readFile(handlerPath)).content;
    if (/^\s*-\s*webhook:\s*\{[^}]*path:\s*demo/m.test(cur)) {
      const patched = cur.replace(/^triggers:\n(?:\s*-\s*webhook:[^\n]*\n)+/m, '');
      await pod.writeFile(handlerPath, patched);
      report.issue(
        'integration-demo ships a legacy webhook trigger that shadows its own emitter def',
        'The deployed integration-demo handler agent declares `triggers: - webhook:{path:demo}` alongside the ' +
          '`events/messages.ts` emitter def. resolveBinding resolves legacy triggers before emitter defs, so inbound ' +
          'deliveries were dispatched to the `handler` LLM agent instead of the code-path emitter+hooks — the exact ' +
          '"a space must not carry both" footgun the skill warns about. Patched the installed copy at runtime.',
        { severity: 'bug', fix: 'store/spaces/integration-demo/agents/handler/instruct.md — removed the legacy triggers block (source; needs a store redeploy for future installs)' },
      );
      report.note('stripped the legacy webhook trigger from the installed demo handler (emitter def now wins)');
    }
  } catch {
    /* handler instruct not present in this build — nothing to patch */
  }

  // 1b. Scaffold the two inert table schemas (app-files API — no loop-guard logic here).
  const putTable = (name, schema) =>
    pod.req('PUT', `/api/projects/${PROJECT}/app/files/database/${name}.json`, { content: JSON.stringify(schema, null, 2) });
  await putTable('messages', {
    title: 'Messages',
    description: 'Every inbound message received from the integration-demo channel.',
    columns: {
      id: { type: 'string', description: 'the provider message id (idempotency key)', primaryKey: true },
      text: { type: 'string', description: 'the message text', default: '' },
      from_user: { type: 'string', description: 'sender id', default: '' },
      chat_id: { type: 'string', description: 'chat/channel id', default: '' },
      word_count: { type: 'number', description: 'word count, filled by the tag hook', default: 0 },
    },
  });
  await putTable('counters', {
    title: 'Counters',
    description: 'Named running counters.',
    columns: {
      id: { type: 'string', description: 'counter id', primaryKey: true },
      name: { type: 'string', description: 'counter name', default: '' },
      value: { type: 'number', description: 'the count', default: 0 },
    },
  });
  report.note('scaffolded database/messages.json + database/counters.json via the app-files API');

  // 1c. The automator authors the hot-path hook INTO THE LIVE PROJECT.
  const automator = new ThingSession(pod, { projectId: PROJECT, agentSlug: 'automator', verbose: true });
  await automator.start();
  const spec =
    `Author ONE event hook into this live project with writeProjectHook, slug "store-message". It must be a ` +
    `plain code \`handler\` (NEVER a \`trigger\` — this is a hot path that must never call a model).\n\n` +
    `Subscribe: { type: 'event', on: { event: 'integration-demo/message.received' } }.\n\n` +
    `The handler receives { input, db }. input is the message payload ` +
    `{ text, from, chatId, userName?, threadKey?, raw }; raw.message.message_id is the provider message id.\n\n` +
    `EXACT db API (get the argument shapes RIGHT — these are the only valid forms):\n` +
    `  - await db.query('messages', { where: { id } })  → returns matching rows (an array). The filter MUST be under \`where\`.\n` +
    `  - await db.insert('messages', { id, text, from_user, chat_id })\n` +
    `  - await db.update('counters', { where: { id: 'stored' }, set: { value: N } })  → note the { where, set } shape.\n\n` +
    `The handler must, in order:\n` +
    `  1. const id = String(input.raw.message.message_id).\n` +
    `  2. const existing = await db.query('messages', { where: { id } }); if (existing.length > 0) return;  // idempotent redelivery\n` +
    `  3. await db.insert('messages', { id, text: input.text, from_user: input.from, chat_id: input.chatId }).\n` +
    `  4. const c = await db.query('counters', { where: { id: 'stored' } }); ` +
    `if (c.length === 0) await db.insert('counters', { id: 'stored', name: 'stored', value: 1 }); ` +
    `else await db.update('counters', { where: { id: 'stored' }, set: { value: Number(c[0].value) + 1 } }).\n\n` +
    `Write it now with writeProjectHook and report .ok.`;
  const aTurn = await automator.send(spec, { timeoutMs: 900_000 });
  report.metric('automator LLM calls', aTurn.llmCalls);
  trace.steps.automator = { text: aTurn.text, yields: aTurn.yields.map((y) => y.kind) };

  // Restart so the freshly-scaffolded db + authored hook boot & wire cleanly.
  report.note('restarting the pod so db + hook boot fresh…');
  await pod.restart();
  await sleep(4_000);
  for (let i = 0; i < 90; i++) {
    if (await pod.req('GET', '/api/env').then(() => true).catch(() => false)) break;
    await sleep(2_000);
  }
  await waitPodSettled(user.token).catch(() => {});

  // Assert the hook landed and is a code handler.
  let hookSrc = '';
  try {
    hookSrc = (await pod.readFile(`${PROJECT}/hooks/store-message.ts`)).content;
    state.storeHook = 'store-message';
  } catch {
    /* asserted below */
  }
  report.check('hook file authored at <project>/hooks/store-message.ts', !!hookSrc, hookSrc ? `${hookSrc.length} bytes` : 'MISSING');
  report.check('hook subscribes to integration-demo/message.received', /integration-demo\/message\.received/.test(hookSrc), 'ok');
  report.check(
    'hook is a CODE handler (no agent trigger in the hot path)',
    /handler\s*[:(]/.test(hookSrc) && !/\btrigger\s*:/.test(hookSrc),
    hookSrc.slice(0, 160).replace(/\n/g, ' '),
  );
  trace.steps.storeHookSrc = hookSrc;

  // Prove the hot path end-to-end with ONE real signed delivery before the storm
  // (unique id so a re-run's pre-existing row doesn't idempotent-skip it).
  const b4 = (await rows(pod, 'messages')).length;
  const r = await deliver(pod, delivery(Date.now() * 10 + 7, 'smoke test'));
  await settle(pod, 'messages', { quietMs: 5_000 });
  const now = (await rows(pod, 'messages')).length;
  const ctr = (await rows(pod, 'counters')).find((x) => x.id === 'stored');
  report.check('a single signed delivery returns 200 {events:1}', r.status === 200 && r.body?.events === 1, JSON.stringify(r.body));
  report.check('the delivery stored exactly one new message row', now === b4 + 1, `${b4} → ${now}`);
  report.check('the counter advanced to reflect the store', Number(ctr?.value) >= 1, `stored=${ctr?.value}`);
  saveState();
}

// ── Step 2 — the storm ────────────────────────────────────────────────────────
if (runStep(2)) {
  report.step(
    'Step 2 — the storm (200 signed inbound deliveries)',
    '200×200 → exactly 200 new rows, counter +200, ZERO LLM calls, no 5xx, pod alive, event loop not starved',
  );

  // Per-run unique message-id base so ids never collide with a prior run's rows
  // (the hook is idempotent on message_id; a collision would silently no-op).
  const BASE = Date.now() * 100;
  const stormBody = (i, text) => delivery(BASE + i, text);
  const counterVal = async () => Number((await rows(pod, 'counters')).find((r) => r.id === 'stored')?.value ?? 0);

  const before = {
    messages: (await rows(pod, 'messages')).length,
    counter: await counterVal(),
    sessions: (await pod.req('GET', '/api/sessions')).sessions.length,
  };
  report.note(`before: ${before.messages} messages, counter=${before.counter}, ${before.sessions} live sessions`);

  // A THING turn issued DURING the storm — the single Node thread must not be starved.
  const bg = new ThingSession(pod, { projectId: PROJECT });
  await bg.start();
  let bgTurn = null;
  let bgErr = null;

  const lat = [];
  const codes = [];
  const wall0 = Date.now();

  // 50 sequential — honest per-delivery latency.
  for (let i = 1; i <= STORM_SEQUENTIAL; i++) {
    const r = await deliver(pod, stormBody(i));
    lat.push(r.ms);
    codes.push(r.status);
  }
  const seqMs = Date.now() - wall0;

  // Kick the concurrent THING turn now that the pod is warm and the storm continues.
  const bgPromise = bg
    .send('In one sentence: what is 2 + 2? Answer directly, do not use any tools.', { timeoutMs: 300_000 })
    .then((t) => (bgTurn = t))
    .catch((e) => (bgErr = e));

  // 150 at concurrency 20.
  const queue = [];
  for (let i = STORM_SEQUENTIAL + 1; i <= STORM_TOTAL; i++) queue.push(i);
  const workers = Array.from({ length: STORM_CONCURRENCY }, async () => {
    for (;;) {
      const i = queue.shift();
      if (i === undefined) return;
      const r = await deliver(pod, stormBody(i));
      lat.push(r.ms);
      codes.push(r.status);
    }
  });
  await Promise.all(workers);
  const wallMs = Date.now() - wall0;

  const sorted = [...lat].sort((a, b) => a - b);
  const ok200 = codes.filter((c) => c === 200).length;
  const fivexx = codes.filter((c) => c >= 500).length;

  report.check(`all ${STORM_TOTAL} deliveries returned 200`, ok200 === STORM_TOTAL, `${ok200}/${codes.length} · 5xx=${fivexx}`);
  report.check('no 5xx', fivexx === 0, String(fivexx));
  report.metric('delivery p50', pct(sorted, 50), ' ms');
  report.metric('delivery p95', pct(sorted, 95), ' ms');
  report.metric('delivery max', sorted[sorted.length - 1], ' ms');
  report.metric('sequential leg (50)', (seqMs / 1000).toFixed(1), ` s → ${(50 / (seqMs / 1000)).toFixed(1)}/s`);
  report.metric('storm wall clock', (wallMs / 1000).toFixed(1), ' s');
  report.metric('storm throughput', (STORM_TOTAL / (wallMs / 1000)).toFixed(1), ' deliveries/s');

  // The event loop must not have been starved.
  await bgPromise;
  report.check(
    'a THING turn issued DURING the storm still completed',
    !!bgTurn && bgTurn.llmCalls > 0,
    bgErr ? `FAILED: ${bgErr.message?.slice(0, 120)}` : `${bgTurn?.llmCalls} llm calls in ${bgTurn?.durationMs}ms`,
  );
  if (bgTurn) report.metric('concurrent THING turn', (bgTurn.durationMs / 1000).toFixed(0), ' s');

  // Rows + counter, once the dispatch queue has drained.
  const n = await settle(pod, 'messages');
  const msgs = await rows(pod, 'messages');
  const ctr = await rows(pod, 'counters');
  const stored = ctr.find((r) => r.id === 'stored' || r.name === 'stored');
  const msgDelta = msgs.length - before.messages;
  const ctrDelta = Number(stored?.value) - before.counter;
  report.check(`the storm stored exactly ${STORM_TOTAL} new rows`, msgDelta === STORM_TOTAL, `+${msgDelta} rows (now ${msgs.length}, was ${before.messages})`);
  report.check(`the counter advanced by exactly ${STORM_TOTAL} (no lost increment under concurrency)`, ctrDelta === STORM_TOTAL, `+${ctrDelta} (now ${stored?.value}, was ${before.counter})`);
  report.metric('rows/sec (end to end)', (n / (wallMs / 1000)).toFixed(1));

  // ZERO LLM calls: no headless agent session may have been created by the hot path.
  const after = (await pod.req('GET', '/api/sessions')).sessions;
  const mine = new Set([state.buildSessionId, bg.sessionId]);
  const strangers = after.filter((s) => !mine.has(s.sessionId));
  report.check(
    'ZERO agent sessions spawned by the storm (no LLM in the hot path)',
    strangers.length === 0,
    strangers.length ? strangers.map((s) => `${s.sessionId}:${s.agentSlug}`).join(',') : 'none',
  );

  trace.steps.storm = { lat, codes, wallMs, rows: msgs.length, counter: stored?.value, bg: bgTurn && { llmCalls: bgTurn.llmCalls, ms: bgTurn.durationMs } };
  state.stormDone = true;
  saveState();

  // ── Edge: burst dedupe — the identical delivery 10× ─────────────────────────
  const raw = delivery(BASE + 999_001, 'replay me');
  const replay = [];
  for (let i = 0; i < 10; i++) replay.push(await deliver(pod, raw));
  await settle(pod, 'messages', { quietMs: 4_000 });
  const afterRows = (await rows(pod, 'messages')).length;
  const deduped = replay.filter((r) => r.body?.deduped === true).length;
  const added = afterRows - msgs.length;
  report.check(
    'a 10× replay of an identical delivery stores exactly ONE row',
    added === 1,
    `+${added} row(s); ${deduped}/10 answered {deduped:true}`,
  );
  report.note(`replay statuses: ${replay.map((r) => r.status).join(',')} · bodies: ${JSON.stringify(replay.map((r) => r.body)).slice(0, 200)}`);
  trace.steps.replay = replay;
}

// ── Step 3 — coalescing + self-write exclusion ───────────────────────────────
if (runStep(3)) {
  report.step(
    'Step 3 — coalescing + self-write exclusion',
    'a hook that writes the table it subscribes to does not re-fire itself; a burst of N writes collapses to ≪N fires',
  );

  const thing = new ThingSession(pod, { projectId: PROJECT, onAsk: approveAllConsent, verbose: true });
  await thing.start();
  const turn = await thing.send(
    `Add two more things to this project's app.\n\n` +
      `(1) A table "hook_runs" (id text primary, hook text, at text) — an audit trail of hook fires.\n\n` +
      `(2) An event hook hooks/tag-word-count.ts, subscribing to "project/db.messages.insert", ` +
      `with a plain code \`handler\` (no agent). Each time it runs it must: insert one row into "hook_runs" ` +
      `(hook: "tag-word-count"), then query "messages" for every row whose word_count is null/undefined and ` +
      `update each one with its text's word count. Note it writes back to "messages" — the same table it ` +
      `subscribes to — so it must be idempotent and must only ever tag rows that are not yet tagged.`,
    { timeoutMs: 900_000 },
  );
  trace.steps.tagBuild = { delegates: turn.delegates, text: turn.text };

  let src = '';
  try {
    src = (await pod.readFile(`${PROJECT}/hooks/tag-word-count.ts`)).content;
  } catch {
    /* asserted below */
  }
  report.check('tag hook authored as a code handler on project/db.messages.insert', /project\/db\.messages\.insert/.test(src) && !/\btrigger\s*:/.test(src), src ? 'ok' : 'MISSING');
  trace.steps.tagHookSrc = src;

  // Burst: N fresh inbound deliveries → N inserts into `messages` in quick succession.
  const N = 30;
  const runsBefore = (await rows(pod, 'hook_runs')).length;
  const msgsBefore = (await rows(pod, 'messages')).length;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: N }, (_, k) => deliver(pod, delivery(500_000 + k, `burst ${k} with five words here`))),
  );
  await settle(pod, 'messages', { quietMs: 8_000 });
  await sleep(8_000); // let the tag hook's own cascade settle too

  const msgsAfter = await rows(pod, 'messages');
  const runsAfter = (await rows(pod, 'hook_runs')).length;
  const fires = runsAfter - runsBefore;
  const added = msgsAfter.length - msgsBefore;
  const untagged = msgsAfter.filter((r) => r.word_count === null || r.word_count === undefined);

  report.check(`the burst added ${N} rows`, added === N, `+${added}`);
  report.check(`a burst of ${N} writes collapses to ≪N hook fires (coalescing)`, fires > 0 && fires < N, `${fires} fires for ${N} writes — ratio 1:${(N / Math.max(fires, 1)).toFixed(1)}`);
  report.check('the tag hook did NOT re-fire itself on its own writes (self-write exclusion)', fires < N, `${fires} fires`);
  report.check('every message row ends up tagged exactly once', untagged.length === 0, `${untagged.length} untagged of ${msgsAfter.length}`);
  report.metric('coalesce ratio (writes:fires)', `${N}:${fires}`);
  report.metric('burst settle', ((Date.now() - t0) / 1000).toFixed(1), ' s');
  trace.steps.coalesce = { N, fires, added, untagged: untagged.length, total: msgsAfter.length };
}

// ── Step 4 — the cycle (depth cap) + self-trigger exclusion ──────────────────
if (runStep(4)) {
  report.step(
    'Step 4 — the A↔B cycle + self-trigger exclusion',
    'the ping-pong terminates at the depth cap with bounded rows and a healthy pod; a hook.fired hook does not trigger itself',
  );

  const thing = new ThingSession(pod, { projectId: PROJECT, onAsk: approveAllConsent, verbose: true });
  await thing.start();
  await thing.send(
    `Two more tables and three more hooks, all plain code handlers (no agents):\n\n` +
      `Tables: "ping" (id text primary, n number) and "pong" (id text primary, n number), and ` +
      `"audit" (id text primary, slug text).\n\n` +
      `Hooks:\n` +
      `  - hooks/a-to-b.ts — on "project/db.ping.insert": insert one row into "pong".\n` +
      `  - hooks/b-to-a.ts — on "project/db.pong.insert": insert one row into "ping".\n` +
      `  - hooks/audit-fires.ts — on "integration-lmthing/hook.fired": insert one row into "audit" with the fired hook's slug.\n\n` +
      `This is a deliberate cycle — I am testing the runtime's loop guard. Author it exactly as asked.`,
    { timeoutMs: 900_000 },
  );

  // integration-lmthing must be installed for hook.fired to exist as an event source.
  const spaces = (await pod.listSpaces(PROJECT)).spaces ?? [];
  const hasLm = spaces.some((s) => (s.id ?? s) === 'integration-lmthing');
  if (!hasLm) {
    await pod.installSpace('integration-lmthing', PROJECT).catch(() => {});
    report.note('installed integration-lmthing directly (THING had not)');
  }

  const before = { ping: (await rows(pod, 'ping')).length, pong: (await rows(pod, 'pong')).length, audit: (await rows(pod, 'audit')).length };

  // Seed ONE row into `ping` — through an agent turn (a user write: cascade depth 0).
  const seeder = new ThingSession(pod, { projectId: PROJECT });
  await seeder.start();
  const t0 = Date.now();
  await seeder.send('Insert exactly one row into the "ping" table: { id: "seed-1", n: 1 }. Nothing else.', { timeoutMs: 300_000 });

  await sleep(15_000);
  await settle(pod, 'ping', { quietMs: 8_000 });
  const cascadeMs = Date.now() - t0;

  const after = { ping: (await rows(pod, 'ping')).length, pong: (await rows(pod, 'pong')).length, audit: (await rows(pod, 'audit')).length };
  const dPing = after.ping - before.ping;
  const dPong = after.pong - before.pong;

  report.check('the A↔B cascade TERMINATED (bounded rows)', dPing < 12 && dPong < 12, `ping +${dPing}, pong +${dPong}`);
  report.check('the cascade terminated quickly', cascadeMs < 120_000, `${(cascadeMs / 1000).toFixed(0)}s`);
  const health = await pod.req('GET', '/api/sessions').then(() => true).catch(() => false);
  report.check('pod healthy after the cascade', health, health ? 'serving' : 'DOWN');
  report.metric('cascade rows (ping/pong)', `${dPing}/${dPong}`);

  // Self-trigger: the audit hook fires on hook.fired and itself writes a row (→ hook.fired).
  const auditRows = await rows(pod, 'audit');
  const selfAudits = auditRows.filter((r) => r.slug === 'audit-fires').length;
  report.check(
    'the hook.fired audit hook does NOT trigger itself (self-trigger exclusion)',
    selfAudits === 0,
    `${selfAudits} self-audit rows of ${auditRows.length}`,
  );
  trace.steps.cycle = { before, after, cascadeMs, selfAudits, auditRows: auditRows.length };
}

// ── Step 5 — a bad space emitter must not take the pod down ──────────────────
if (runStep(5)) {
  report.step(
    'Step 5 — worker containment',
    'a throwing / 60s-spinning space emitter is contained; the pod stays up and the instrumented path is unaffected',
  );

  const mk = async (id, body) => {
    await pod.writeFile(
      `${PROJECT}/spaces/${id}/package.json`,
      JSON.stringify({ name: id, version: '1.0.0', private: true, lmthing: { kind: 'integration', title: id } }, null, 2),
    );
    await pod.writeFile(`${PROJECT}/spaces/${id}/events/bad.ts`, body);
  };

  const defFor = (evil) => `
const def = {
  type: 'internal',
  on: { signal: 'session.started' },
  emits: { 'noop': { payload: { ok: 'string' } } },
  emit(signal) {
    ${evil}
    return [{ event: 'noop', payload: { ok: 'never' } }];
  },
};
export default def;
`;

  await mk('badspace-throw', defFor(`throw new Error('deliberate emitter explosion');`));
  await mk(
    'badspace-hang',
    defFor(`const until = Date.now() + 60000; while (Date.now() < until) { /* spin */ }`),
  );
  report.note('installed two project-local spaces whose internal emitter throws / spins 60s on session.started');

  // Fire the instrumented path (session.started) and assert it is unaffected.
  const t0 = Date.now();
  const probe = new ThingSession(pod, { projectId: PROJECT });
  await probe.start();
  const turn = await probe.send('Reply with the single word: alive.', { timeoutMs: 300_000 }).catch((e) => ({ error: e }));
  const probeMs = Date.now() - t0;

  report.check('the instrumented path (a session turn) still completed', !turn.error && turn.llmCalls > 0, turn.error ? String(turn.error).slice(0, 120) : `${turn.llmCalls} llm calls`);
  report.check('the pod is still up after a throwing + hanging emitter', await pod.req('GET', '/api/sessions').then(() => true).catch(() => false));
  report.metric('turn latency with a hanging emitter installed', (probeMs / 1000).toFixed(0), ' s');

  // Other hooks keep firing: one more inbound delivery must still land.
  const b4 = (await rows(pod, 'messages')).length;
  const r = await deliver(pod, delivery(700_001, 'still alive'));
  await settle(pod, 'messages', { quietMs: 5_000 });
  const now = (await rows(pod, 'messages')).length;
  report.check('other hooks keep firing (inbound still stores a row)', r.status === 200 && now === b4 + 1, `${r.status} · +${now - b4} row`);
  trace.steps.containment = { probeMs, inbound: r.status };

  // Neuter the bad emitters so the hang doesn't tax the remaining steps (there is
  // no fs delete route — overwriting the def with a benign one is the uninstall).
  const benign = `const def = { type: 'internal', on: { signal: 'never.fires' }, emits: { noop: { payload: { ok: 'string' } } }, emit() { return []; } };\nexport default def;\n`;
  await pod.writeFile(`${PROJECT}/spaces/badspace-throw/events/bad.ts`, benign).catch(() => {});
  await pod.writeFile(`${PROJECT}/spaces/badspace-hang/events/bad.ts`, benign).catch(() => {});
}

// ── Step 6 — restart mid-flight → auto-resume + system message ───────────────
if (runStep(6)) {
  report.step(
    'Step 6 — restart mid-flight → auto-resume',
    'the pod comes back, the session resumes with history intact, a system message announces the restart, committed data survives',
  );

  const thing = new ThingSession(pod, { projectId: PROJECT, verbose: true });
  await thing.start();
  await thing.send('Remember this word: PERSIMMON. Just acknowledge it.', { timeoutMs: 300_000 });
  const sessionId = thing.sessionId;
  const historyBefore = thing.events.length;
  const msgsBefore = (await rows(pod, 'messages')).length;

  // Kick a LONG turn and restart the pod while it is in flight.
  const inflight = pod
    .req('POST', `/api/sessions/${sessionId}/message`, {
      content: 'Research the history of the Antikythera mechanism in depth and write a long report.',
    })
    .catch((e) => ({ error: String(e) }));
  await inflight;
  await sleep(12_000); // let the turn actually get going

  const running = (await pod.req('GET', '/api/sessions')).sessions.find((s) => s.sessionId === sessionId);
  report.check('a turn was in flight when we restarted', running?.status === 'running', `status=${running?.status}`);

  const tRestart = Date.now();
  await pod.restart();
  report.note('POST /api/restart issued');

  // Wait for the pod to serve again, then resume.
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await sleep(2_000);
    up = await pod.req('GET', '/api/env').then(() => true).catch(() => false);
  }
  const backMs = Date.now() - tRestart;
  report.check('the pod came back', up, `${(backMs / 1000).toFixed(0)}s`);

  // The old in-memory session must be gone (proving the process really restarted).
  const gone = await pod
    .req('GET', `/api/sessions/${sessionId}/events?since=0&format=json`)
    .then(() => false)
    .catch((e) => e.status === 404);
  report.check('the in-memory session died with the pod (a real restart)', gone, gone ? '404 as expected' : 'still live?!');

  // Resume it.
  const resumed = new ThingSession(pod, { projectId: PROJECT, verbose: false });
  const tResume = Date.now();
  await resumed.start({ resumeSessionId: sessionId });
  await sleep(4_000);
  await resumed.pullEvents();
  const resumableMs = Date.now() - tRestart;

  const hist = resumed.events;
  const userMsgs = hist.filter((e) => e.type === 'user_message').map((e) => e.content);
  report.check('the session resumed with its prior history', hist.length > 0, `${hist.length} trace events replayed`);
  report.check('the pre-restart conversation is intact (PERSIMMON turn present)', userMsgs.some((c) => /PERSIMMON/.test(c ?? '')), userMsgs.map((c) => String(c).slice(0, 40)).join(' | ').slice(0, 200));

  const sysText = JSON.stringify(hist.filter((e) => e.type === 'display' || e.type === 'user_message'));
  const announced = /restart|restored|reconnect|interrupted/i.test(sysText);
  report.check('a system message announces the restart/config change', announced, announced ? 'present' : 'ABSENT — nothing in the resumed history mentions the restart');

  // The in-flight turn must not silently claim success.
  const claimed = /Antikythera/i.test(JSON.stringify(hist.filter((e) => e.type === 'display')));
  report.check('the in-flight turn did NOT silently claim success', !claimed, claimed ? 'a completed Antikythera report is in history!' : 'no phantom result');

  // Durable data survived.
  const msgsAfter = (await rows(pod, 'messages')).length;
  report.check('durably-committed data survived the restart', msgsAfter === msgsBefore, `${msgsAfter} rows (was ${msgsBefore})`);

  // The resumed session must still take a turn.
  const t = await resumed.send('What word did I ask you to remember?', { timeoutMs: 300_000 }).catch((e) => ({ error: e }));
  report.check('the resumed session can take a new turn', !t.error && t.llmCalls > 0, t.error ? String(t.error).slice(0, 120) : `${t.llmCalls} llm calls`);
  report.check('the resumed agent still has the pre-restart context', /persimmon/i.test(t.text ?? ''), (t.text ?? '').slice(0, 120));
  report.metric('restart → session resumable', (resumableMs / 1000).toFixed(0), ' s');
  report.metric('restart → pod serving', (backMs / 1000).toFixed(0), ' s');
  trace.steps.restart = { backMs, resumableMs, historyBefore, historyAfter: hist.length, announced, claimed };

  // ── Cold wake from scale-to-zero ───────────────────────────────────────────
  report.note('scaling to zero and cold-waking…');
  const st = await podStatus(user.token).catch(() => null);
  trace.steps.podStatusBeforeIdle = st?.pod;
  // The pod scales itself to zero when idle; force the path the user hits by
  // waiting for the idle scale-down, then timing the first byte back.
  const idleWait = Number(process.env.LM_IDLE_WAIT_MS ?? 0);
  if (idleWait > 0) {
    await sleep(idleWait);
    const t0 = Date.now();
    const ok = await pod.req('GET', '/api/env').then(() => true).catch(() => false);
    report.check('cold-wake serves', ok, `${((Date.now() - t0) / 1000).toFixed(1)}s to first byte`);
    report.metric('cold-wake → first byte', ((Date.now() - t0) / 1000).toFixed(1), ' s');
  } else {
    report.note('cold-wake measured separately (set LM_IDLE_WAIT_MS to fold it into this run)');
  }
}

// ── report ────────────────────────────────────────────────────────────────────
const out = `${SDK_ORG}/scenarios/results/03-resilience-report.md`;
report.save(out);
mkdirSync(`${SDK_ORG}/scenarios/results`, { recursive: true });
writeFileSync(`${SDK_ORG}/scenarios/results/03-resilience-trace.json`, JSON.stringify(trace, null, 2));
console.log(JSON.stringify(report.summary(), null, 2));

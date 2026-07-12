#!/usr/bin/env node
/** Focused emitEvent validation (scenario 04, Step 3 edges) — surfaces in the session trace,
 *  no recorder db needed. Uses the installed integration-lmthing `publisher` agent (has
 *  events:emit; its scope is integration-lmthing, host-derived). */
import { Pod } from '../harness/lib/pod.mjs';
import { ThingSession } from '../harness/lib/thing.mjs';
import { getUser } from '../harness/provision.mjs';

const PROJECT = 'observatory';
const user = await getUser('observatory');
const pod = new Pod({ base: user.pod, token: user.token });
const log = (...a) => console.log(...a);

const errText = (turn) =>
  turn.events.filter((e) => e.type === 'yield_error' || e.type === 'eval_error' || e.type === 'typecheck_error')
    .map((e) => `${e.type}:${e.message ?? ''}`).join(' || ') || '(none)';

// 1) publisher (events:emit, scope=integration-lmthing) — declared vs undeclared vs bad payload.
const pub = new ThingSession(pod, { projectId: PROJECT, agentSlug: 'publisher', verbose: false });
await pub.start().catch((e) => log('publisher start err', e.message));
log('\n[A] undeclared event name → must be refused ("not declared"):');
const a = await pub.send('Run exactly: const r = await emitEvent("totally.undeclared", { x: 1 }); display(JSON.stringify(r));', { timeoutMs: 300_000 }).catch((e) => e.turn ?? { events: [], text: String(e) });
log('   errs:', errText(a).slice(0, 260), '| text:', (a.text || '').slice(0, 160));

log('\n[B] declared event, WRONG payload type → must be refused ("schema"):');
const b = await pub.send('Run exactly: const r = await emitEvent("session.completed", { projectId: "observatory", agent: "x", sessionId: "s", ok: "notabool", durationMs: 5 }); display(JSON.stringify(r));', { timeoutMs: 300_000 }).catch((e) => e.turn ?? { events: [], text: String(e) });
log('   errs:', errText(b).slice(0, 260), '| text:', (b.text || '').slice(0, 160));

log('\n[C] a PROJECT-scoped address from a SPACE agent → refused (scope host-derived):');
const c = await pub.send('Run exactly: const r = await emitEvent("report.ready", { title: "spoof", count: 1 }); display(JSON.stringify(r));', { timeoutMs: 300_000 }).catch((e) => e.turn ?? { events: [], text: String(e) });
log('   errs:', errText(c).slice(0, 260), '| text:', (c.text || '').slice(0, 160));

// 2) an agent WITHOUT events:emit (engineer) — emitEvent must not even typecheck.
const eng = new ThingSession(pod, { projectId: PROJECT, agentSlug: 'engineer', verbose: false });
await eng.start().catch((e) => log('engineer start err', e.message));
log('\n[D] agent without events:emit → emitEvent is not in the DTS (typecheck failure):');
const d = await eng.send('Run exactly this one statement: await emitEvent("report.ready", { title: "x", count: 1 });', { timeoutMs: 300_000 }).catch((e) => e.turn ?? { events: [], text: String(e) });
log('   errs:', errText(d).slice(0, 300), '| text:', (d.text || '').slice(0, 160));

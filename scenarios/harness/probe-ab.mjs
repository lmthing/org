/**
 * A/B a THING prompt change against live prod, N trials per variant.
 *
 * The offer behaviour is FLAKY, so a single run proves nothing in either direction. Patch the
 * variant once, restart once, then drive the same opener on N FRESH projects and count how often
 * THING (a) actually OFFERS and (b) grounds the offer in the user's OWN material.
 *
 *   node probe-ab.mjs <label> <instruct.md> <N>
 */
import { readFileSync } from 'node:fs';
import { getUser } from './provision.mjs';
import { Pod } from './lib/pod.mjs';
import { ThingSession } from './lib/thing.mjs';

const [label, file, nRaw] = process.argv.slice(2);
const N = Number(nRaw ?? 3);
const FIX = process.env.FIX;
const src = readFileSync(file, 'utf8');

const user = await getUser('latam');
const pod = new Pod({ base: user.pod, token: user.token, onLocalRestart: user.onLocalRestart });

await pod.req('PUT', '/api/fs/write', {
  path: 'system/spaces/user-thing/agents/thing/instruct.md',
  content: src,
});
const back = await pod.readFile('system/spaces/user-thing/agents/thing/instruct.md');
const got = typeof back === 'string' ? back : (back?.content ?? '');
if (got.length !== src.length) throw new Error(`patch did NOT land: wrote ${src.length}, read ${got.length}`);
console.log(`[${label}] instruct landed (${got.length} chars) · offer-rule=${/But OFFER/.test(got)} · grounding-rule=${/must come from THEIR material/.test(got)}`);

await pod.restart();
for (let i = 0; i < 120; i++) {
  try { await pod.listProjects(); break; } catch { await new Promise((r) => setTimeout(r, 3000)); }
}

const flat = (d) =>
  d == null ? '' :
  typeof d === 'string' ? d :
  Array.isArray(d) ? d.map(flat).join(' ') :
  typeof d === 'object'
    ? [d.props?.title, d.props?.text, d.props?.label, JSON.stringify(d.props?.pairs ?? ''), JSON.stringify(d.props?.rows ?? ''), flat(d.children)].filter(Boolean).join(' ')
    : String(d);

// Does it PROPOSE, in the user's language? (broad — any form of "shall I make you one")
const OFFER = /\b(want me to|shall i|should i|would you like|do you want|i can (build|make|set|put|turn|create|give)|i could (build|make|set|put|turn|create)|let me (build|make|set|put|turn|create)|turn (it|this|that) into|i'?d suggest)\b/i;
// HER material (from the notes she actually attached) vs an INVENTED illustrative specific.
const HERS = /\b(mexico|guatemala|colombia|peru|bolivia|chile|argentina|brazil|cusco|la paz|uyuni|machu picchu|wild rover|oaxaca|patagonia|yellow fever|portuguese)\b/i;
const INVENTED = /\b(vietnam|bangkok|thailand|tokyo|japan|paris|europe|london|bali|india|nepal)\b/i;

const rows = [];
for (let i = 0; i < N; i++) {
  const proj = `ab-${label.toLowerCase()}-${i}-${Date.now().toString(36)}`;
  await pod.createProject(proj);
  const thing = new ThingSession(pod, { projectId: proj, onAsk: () => ({}), verbose: false });
  await thing.start();
  const notes = await pod.upload(`${FIX}/trip-notes.md`);
  const t = await thing.sendWithAttachments(
    'omg ok. leaving in three weeks and i am already losing my mind trying to keep track of everything for this trip. dumping my notes here, can u help me actually get on top of this instead of it just living in my head',
    [notes],
    { timeoutMs: 900_000 },
  );
  const seen = (t.displays ?? []).map(flat).join('\n') || flat(t.lastText);
  const authored = t.yields.filter((y) => /^writeProject/.test(y.kind)).length;
  const r = {
    offered: OFFER.test(seen),
    grounded: HERS.test(seen),
    invented: INVENTED.test(seen),
    authored,
    chars: seen.length,
  };
  rows.push(r);
  console.log(`  trial ${i + 1}/${N}: offer=${r.offered ? '✅' : '❌'} grounded=${r.grounded ? '✅' : '❌'} invented=${r.invented ? '⚠️ YES' : 'no'} authored=${authored} (${r.chars}c)`);
  await pod.deleteProject(proj).catch(() => {});
}

const n = (k) => rows.filter((r) => r[k]).length;
console.log(`\n╔═══ ${label} · N=${N}`);
console.log(`║ OFFERED            ${n('offered')}/${N}`);
console.log(`║ grounded in HERS   ${n('grounded')}/${N}`);
console.log(`║ INVENTED specifics ${n('invented')}/${N}  ← must be 0`);
console.log(`║ authored unasked   ${rows.filter((r) => r.authored > 0).length}/${N}  ← must be 0 (restraint)`);
console.log(`╚═══`);

#!/usr/bin/env node
/**
 * Code-node runtime verification v2 (scenario 04, Steps 4–6): fixes the store-node deps,
 * adds a forEach fan-out + collector, and the isolation/failure edges — each a tiny tasklist
 * run headless via a hook so we can read the envelope. Reuses the `digest` space authored by v1.
 */
import { Pod } from '../harness/lib/pod.mjs';
import { getUser } from '../harness/provision.mjs';

const PROJECT = 'observatory';
const user = await getUser('observatory');
const pod = new Pod({ base: user.pod, token: user.token });
const log = (...a) => console.log(...a);
const write = (p, c) => pod.writeFile(p, typeof c === 'string' ? c : JSON.stringify(c, null, 2));
const runHook = (slug) => pod.req('POST', `/api/projects/${PROJECT}/hooks/${slug}/run`, {}).catch((e) => ({ error: e.message, body: e.body }));
const rows = (t) => pod.appData(PROJECT, t).then((r) => r.rows ?? r).catch(() => []);
const SPACE = `${PROJECT}/spaces/digest`;

// ── Fix 03-store: depend on BOTH format and research; store rows. ──────────────
await write(`${SPACE}/tasklists/digest/03-store.ts`, `// dependsOn BOTH upstream nodes → inputs.research AND inputs.format are keyed by node id.
export const node = { id: 'store', dependsOn: ['format', 'research'] };
export async function run(ctx, inputs) {
  const findings = Array.isArray(inputs.research?.findings) ? inputs.research.findings : [];
  let stored = 0;
  for (const f of findings) {
    await ctx.db.insert('digest', { topic: String(inputs.topic), finding: String(f), summary: String(inputs.research?.summary ?? ''), at: Date.now() });
    stored++;
  }
  return { stored, wiring: { seedTopLevel: inputs.topic !== undefined && inputs.seed === undefined, researchByNodeId: inputs.research?.summary !== undefined, formatByNodeId: inputs.format?.markdown !== undefined } };
}
`);

// ── forEach fan-out: one code-node execution per finding, then a collector. ────
await write(`${SPACE}/tasklists/digest/04-per_finding.ts`, `// forEach over the upstream array inputs.research.findings → N parallel executions.
// Each element arrives as \`inputs.item\` (+ inputs.index).
export const node = { id: 'per_finding', dependsOn: ['research'], forEach: 'research.findings' };
export async function run(ctx, inputs) {
  return { index: inputs.index, text: String(inputs.item), len: String(inputs.item).length };
}
`);
await write(`${SPACE}/tasklists/digest/05-collect.ts`, `// The collector receives ALL N per_finding outputs as an array (inputs.per_finding).
export const node = { id: 'collect', dependsOn: ['per_finding', 'store'], goal: true };
export async function run(ctx, inputs) {
  const all = Array.isArray(inputs.per_finding) ? inputs.per_finding : [];
  return { n: all.length, indexes: all.map((x) => x.index), stored: inputs.store?.stored ?? 0, wiring: inputs.store?.wiring };
}
`);

// ── Isolation / failure edges — tiny code-only tasklists (no agent node). ──────
await write(`${SPACE}/tasklists/edge_fetch/index.md`, `---\ninput:\n  x: string\n---\nEdge: a code node reaching for ctx.fetch.\n`);
await write(`${SPACE}/tasklists/edge_fetch/01-fetchy.ts`, `export const node = { id: 'fetchy' };
export async function run(ctx, inputs) {
  const hasFetch = typeof ctx.fetch === 'function';         // must be false — ctx = {db,delegate,callConnection}
  let threw = false; let msg = '';
  try { await ctx.fetch('https://example.com'); } catch (e) { threw = true; msg = String(e && e.message || e); }
  return { hasFetch, threw, msg: msg.slice(0, 200) };
}
`);
await write(`${SPACE}/tasklists/edge_conn/index.md`, `---\ninput:\n  x: string\n---\nEdge: a code node calling callConnection for an undeclared provider.\n`);
await write(`${SPACE}/tasklists/edge_conn/01-conny.ts`, `export const node = { id: 'conny' };
export async function run(ctx, inputs) {
  let threw = false; let msg = '';
  try { await ctx.callConnection('slack', { op: 'x' }); } catch (e) { threw = true; msg = String(e && e.message || e); }
  return { threw, msg: msg.slice(0, 200) };
}
`);
await write(`${SPACE}/tasklists/edge_throw/index.md`, `---\ninput:\n  x: string\n---\nEdge: a code node that throws → required-task failure, downstream skipped.\n`);
await write(`${SPACE}/tasklists/edge_throw/01-boom.ts`, `export const node = { id: 'boom' };
export async function run(ctx, inputs) { throw new Error('code node intentionally exploded'); }
`);
await write(`${SPACE}/tasklists/edge_throw/02-after.ts`, `export const node = { id: 'after', dependsOn: ['boom'], goal: true };
export async function run(ctx, inputs) { await ctx.db.insert('digest', { topic: 'SHOULD-NOT-RUN', finding: 'after-throw', at: Date.now() }); return { ran: true }; }
`);

// Hooks that run each edge tasklist headless and return the envelope.
for (const [slug, ref] of [['run-digest', 'digest/digest'], ['run-edge-fetch', 'digest/edge_fetch'], ['run-edge-conn', 'digest/edge_conn'], ['run-edge-throw', 'digest/edge_throw']]) {
  await write(`${PROJECT}/hooks/${slug}.ts`, `export default {
  type: 'event', on: { event: 'project/run.${slug}' },
  handler: async ({ tasklist, db }) => {
    const started = Date.now();
    let result, err = null;
    try { result = await tasklist.run('${ref}', { topic: 'the James Webb Space Telescope', x: 'x' }); }
    catch (e) { err = String(e && e.message || e); }
    await db.insert('edge_runs', { slug: '${slug}', ok: !!(result && result.ok), err: err || '', data: JSON.stringify(result ?? null), ms: Date.now() - started, at: Date.now() });
    return { result, err };
  },
};
`);
}
await write(`${PROJECT}/database/edge_runs.json`, {
  title: 'Edge runs', description: 'Envelopes from headless edge tasklist runs',
  columns: {
    id: { type: 'string', description: 'id', primaryKey: true, generated: 'uuid' },
    slug: { type: 'string', description: 'which edge', default: '' },
    ok: { type: 'boolean', description: 'envelope ok', default: false },
    err: { type: 'string', description: 'error if the run threw', default: '' },
    data: { type: 'string', description: 'full envelope JSON', default: '' },
    ms: { type: 'number', description: 'duration', default: 0 },
    at: { type: 'number', description: 'ms', default: 0 },
  },
});

log('authored v2 nodes/edges; restarting to boot edge_runs table…');
await pod.restart().catch(() => {});
const { waitPodReady, waitPodSettled } = await import('../harness/lib/gateway.mjs');
await waitPodReady(user.token).catch(() => {});
await waitPodSettled(user.token).catch(() => {});

// Edges first (fast — no agent node).
for (const slug of ['run-edge-fetch', 'run-edge-conn', 'run-edge-throw']) {
  const t0 = Date.now();
  const res = await runHook(slug);
  log(`\n[${slug}] ${((Date.now() - t0) / 1000).toFixed(1)}s ->`, JSON.stringify(res).slice(0, 500));
}

// The full mixed DAG + forEach (has an agent node — slow). Count digest_runs delta.
const before = (await rows('digest_runs')).length;
const digestBefore = (await rows('digest')).length;
const t1 = Date.now();
const res = await runHook('run-digest');
log(`\n[run-digest] ${((Date.now() - t1) / 1000).toFixed(1)}s -> ok=${JSON.stringify(res?.result?.ok)} data=${JSON.stringify(res?.result?.data).slice(0, 400)}`);
const after = (await rows('digest_runs')).length;
const digestAfter = (await rows('digest')).length;
log(`digest_runs delta for ONE hook call: ${after - before} (expect 1)`);
log(`digest rows written by the code node: ${digestAfter - digestBefore}`);
log('newest digest sample:', JSON.stringify((await rows('digest')).slice(-2)));
log('\nedge_runs:', JSON.stringify((await rows('edge_runs')).map((r) => ({ slug: r.slug, ok: r.ok, err: String(r.err).slice(0, 80), data: String(r.data).slice(0, 220) })), null, 1));

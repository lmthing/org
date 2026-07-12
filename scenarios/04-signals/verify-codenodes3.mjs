#!/usr/bin/env node
/** v3 — rewrite the runner hooks with VALID (dash-free) event-address names; reuse the
 *  digest space + node files + edge_runs table authored by v2. No restart (hooks hot-reload). */
import { Pod } from '../harness/lib/pod.mjs';
import { getUser } from '../harness/provision.mjs';

const PROJECT = 'observatory';
const user = await getUser('observatory');
const pod = new Pod({ base: user.pod, token: user.token });
const log = (...a) => console.log(...a);
const write = (p, c) => pod.writeFile(p, typeof c === 'string' ? c : JSON.stringify(c, null, 2));
const runHook = (slug) => pod.req('POST', `/api/projects/${PROJECT}/hooks/${slug}/run`, {}).catch((e) => ({ error: e.message }));
const rows = (t) => pod.appData(PROJECT, t).then((r) => r.rows ?? r).catch(() => []);

for (const [slug, ref, ev] of [
  ['run-digest', 'digest/digest', 'run.digest'],
  ['run-edge-fetch', 'digest/edge_fetch', 'run.edgefetch'],
  ['run-edge-conn', 'digest/edge_conn', 'run.edgeconn'],
  ['run-edge-throw', 'digest/edge_throw', 'run.edgethrow'],
]) {
  await write(`${PROJECT}/hooks/${slug}.ts`, `export default {
  type: 'event', on: { event: 'project/${ev}' },
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

// Edges (fast — no agent node).
for (const slug of ['run-edge-fetch', 'run-edge-conn', 'run-edge-throw']) {
  const t0 = Date.now();
  const res = await runHook(slug);
  log(`[${slug}] ${((Date.now() - t0) / 1000).toFixed(1)}s ->`, JSON.stringify(res).slice(0, 400));
}

// Full mixed DAG + forEach (agent node). Count digest_runs delta from ONE call.
const before = (await rows('digest_runs')).length;
const digestBefore = (await rows('digest')).length;
const t1 = Date.now();
const res = await runHook('run-digest');
const dms = ((Date.now() - t1) / 1000).toFixed(1);
log(`\n[run-digest] ${dms}s -> ok=${JSON.stringify(res?.result?.ok)} data=${JSON.stringify(res?.result?.data)}`);
const after = (await rows('digest_runs')).length;
const digestAfter = (await rows('digest')).length;
log(`digest_runs delta for ONE hook call: ${after - before} (expect 1)`);
log(`digest rows written by code node this run: ${digestAfter - digestBefore}`);
log('newest digest sample:', JSON.stringify((await rows('digest')).slice(-2)));
log('\nedge_runs:', JSON.stringify((await rows('edge_runs')).map((r) => ({ slug: r.slug, ok: r.ok, err: String(r.err).slice(0, 90), data: String(r.data).slice(0, 200) })), null, 1));

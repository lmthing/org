#!/usr/bin/env node
/**
 * Focused LIVE verification of the code-node RUNTIME (scenario 04, Steps 4–6).
 *
 * The system spaces have NO authoring path for code nodes (no writeCodeNode fn, no
 * knowledge — see the report), so the runner provisions the `digest` SPACE + tasklist
 * files directly (harness substrate) to prove the RUNTIME works: static `node` metadata
 * extraction, inputs keyed by node id, seed keys at top level, code nodes making 0 model
 * calls, forEach fan-out, a hook running the tasklist headless and RECEIVING its result,
 * and the isolation/failure edges. Run: node ../04-signals/verify-codenodes.mjs
 */
import { Pod } from '../harness/lib/pod.mjs';
import { getUser } from '../harness/provision.mjs';

const PROJECT = 'observatory';
const user = await getUser('observatory');
const pod = new Pod({ base: user.pod, token: user.token });
const log = (...a) => console.log(...a);

const write = (p, c) => pod.writeFile(p, typeof c === 'string' ? c : JSON.stringify(c, null, 2));
const runHook = (slug) => pod.req('POST', `/api/projects/${PROJECT}/hooks/${slug}/run`, {});
const rows = (t) => pod.appData(PROJECT, t).then((r) => r.rows ?? r).catch(() => []);

// ── the `digest` space + mixed-DAG tasklist ────────────────────────────────────
const SPACE = `${PROJECT}/spaces/digest`;
await write(`${SPACE}/package.json`, { name: 'digest', version: '1.0.0', private: true, lmthing: { kind: 'workflow', title: 'Digest', tags: ['workflow'] } });

// Tasklist-level seed declaration: `topic` stays a TOP-LEVEL input key for every node.
await write(`${SPACE}/tasklists/digest/index.md`, `---
input:
  topic: string
---
Research a topic, then format and store the findings — the model researches, code does the rest.
`);

// 01 — AGENT node: real webSearch/webFetch. Contributes ≥1 llm_response.
await write(`${SPACE}/tasklists/digest/01-research.md`, `---
id: research
output:
  findings: array
  summary: string
---
Research the seed \`topic\` with webSearch (and webFetch if useful). Produce 3–5 short factual
findings (an array of strings) and a one-sentence summary.
Resolve: currentTask.resolve({ findings: [...], summary: "<one sentence>" })
`);

// 02 — CODE node: pure formatting, NO model. Reads upstream by node id + seed at top level.
await write(`${SPACE}/tasklists/digest/02-format.ts`, `// A deterministic code node — no LLM. \`inputs.research\` is the upstream node's output
// (keyed by node id); \`inputs.topic\` is the SEED key at TOP LEVEL (NOT inputs.seed.topic).
export const node = { id: 'format', dependsOn: ['research'] };
export async function run(ctx, inputs) {
  const findings = Array.isArray(inputs.research?.findings) ? inputs.research.findings : [];
  const lines = findings.map((f, i) => (i + 1) + '. ' + String(f));
  return {
    topicSeen: inputs.topic,                       // proves the seed rode in at top level
    hasResearchByNodeId: inputs.research !== undefined && inputs.research.summary !== undefined,
    sawSeedNested: inputs.seed !== undefined,       // must be false — seed is NOT nested under .seed
    markdown: '# ' + String(inputs.topic) + '\\n' + lines.join('\\n'),
    count: findings.length,
  };
}
`);

// 03 — CODE node: writes one row per finding into the `digest` table via ctx.db.
await write(`${SPACE}/tasklists/digest/03-store.ts`, `// Depends on \`format\`; writes to the project db via ctx.db (no model). Reads BOTH the
// seed (inputs.topic) and two upstream nodes by id (inputs.research, inputs.format).
export const node = { id: 'store', dependsOn: ['format'] };
export async function run(ctx, inputs) {
  const findings = Array.isArray(inputs.research?.findings) ? inputs.research.findings : [];
  let stored = 0;
  for (const f of findings) {
    await ctx.db.insert('digest', { topic: String(inputs.topic), finding: String(f), summary: String(inputs.research?.summary ?? ''), at: Date.now() });
    stored++;
  }
  return { stored, topicSeen: inputs.topic, formatCount: inputs.format?.count, wiring: { seedTopLevel: inputs.topic !== undefined && inputs.seed === undefined, researchByNodeId: inputs.research?.summary !== undefined, formatByNodeId: inputs.format?.markdown !== undefined } };
}
`);

// the digest table
await write(`${PROJECT}/database/digest.json`, {
  title: 'Digest', description: 'Stored digest findings (written by a code node)',
  columns: {
    id: { type: 'string', description: 'id', primaryKey: true, generated: 'uuid' },
    topic: { type: 'string', description: 'the researched topic', default: '' },
    finding: { type: 'string', description: 'one finding', default: '' },
    summary: { type: 'string', description: 'the research summary', default: '' },
    at: { type: 'number', description: 'ms epoch', default: 0 },
  },
});

// a hook that runs the whole tasklist HEADLESS and returns its result (Step 5's "does not drop result")
await write(`${PROJECT}/hooks/run-digest.ts`, `export default {
  type: 'event',
  on: { event: 'project/run.digest' },
  handler: async ({ input, tasklist, db }) => {
    const topic = (input && input.topic) || 'the James Webb Space Telescope';
    const result = await tasklist.run('digest/digest', { topic });   // headless space tasklist
    // Persist a proof row so the harness can confirm the handler RECEIVED the result.
    await db.insert('digest_runs', { topic, ok: !!(result && result.ok), data: JSON.stringify(result), at: Date.now() });
    return result;
  },
};
`);
await write(`${PROJECT}/events/run-digest-emitter.ts`, `export default {
  type: 'internal', on: { signal: 'never.digest' },
  emits: { 'run.digest': { payload: { topic: 'string' } } },
  emit: () => [],
};
`);
await write(`${PROJECT}/database/digest_runs.json`, {
  title: 'Digest runs', description: 'Proof that the hook received the headless tasklist result',
  columns: {
    id: { type: 'string', description: 'id', primaryKey: true, generated: 'uuid' },
    topic: { type: 'string', description: 'topic', default: '' },
    ok: { type: 'boolean', description: 'result.ok', default: false },
    data: { type: 'string', description: 'full result JSON', default: '' },
    at: { type: 'number', description: 'ms', default: 0 },
  },
});

log('authored digest space + tasklist + hook + tables; restarting pod to boot new tables…');
await pod.restart().catch(() => {});
const { waitPodReady, waitPodSettled } = await import('../harness/lib/gateway.mjs');
await waitPodReady(user.token).catch(() => {});
await waitPodSettled(user.token).catch(() => {});

log('running the run-digest hook (headless digest tasklist)…');
const t0 = Date.now();
const res = await runHook('run-digest').catch((e) => ({ error: e.message, body: e.body }));
const ms = Date.now() - t0;
log('hook result:', JSON.stringify(res).slice(0, 900));
log('wall:', (ms / 1000).toFixed(1), 's');

const digestRows = await rows('digest');
const runRows = await rows('digest_runs');
log('\ndigest rows:', digestRows.length);
log('sample:', JSON.stringify(digestRows.slice(0, 2)));
log('digest_runs rows:', runRows.length, JSON.stringify(runRows.map((r) => ({ ok: r.ok, topic: r.topic, data: String(r.data).slice(0, 300) }))));

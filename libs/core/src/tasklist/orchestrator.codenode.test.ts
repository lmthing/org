import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTasklist } from './orchestrator.js';
import type { CodeNodeCtxFactory } from './orchestrator.js';
import { ForkEngine } from '../fork/fork.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * Code-node execution in the orchestrator (plan step S2). Core never imports a
 * code node's module — the orchestrator calls an injected `codeNodeCtxFactory`.
 * These tests supply an in-memory factory (standing in for the CLI/pod's worker
 * runner) and assert code-node output feeds the DAG identically to an agent
 * node: dependsOn wiring, forEach fan-out (as a body AND as the array source),
 * required-task-failure propagation, and the no-factory error.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-codeorch-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'main'), { recursive: true });
  await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
  const tl = join(dir, 'tasklists', 'flow');
  await mkdir(tl, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(tl, name), contents, 'utf8');
  }
  return dir;
}

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

/** ForkEngine wired to a mock streamFn answering agent nodes by output-schema token. */
function engineFor(dir: string, answers: Array<{ token: string; code: string }>): ForkEngine {
  const streamFn = createMockStreamFn((o: StreamOpts) => {
    const user = o.messages.map((m) => m.content).join('\n');
    for (const a of answers) {
      if (user.includes('Output schema:') && user.includes(a.token)) return a.code;
    }
    return '';
  });
  return new ForkEngine({
    maxConcurrentForks: 4,
    parentHistory: [],
    parentSpaceDir: dir,
    parentAgentSlug: 'main',
    renderHost: silentHost,
    streamFn,
  });
}

/** A code-node factory backed by an in-memory { taskId -> run } map. Records the
 *  inputs each code node received so tests can assert seed/upstream threading. */
function factoryFrom(
  runners: Record<string, (inputs: Record<string, unknown>) => unknown>,
  seenInputs?: Record<string, Record<string, unknown>>,
): CodeNodeCtxFactory {
  return (node) => ({
    runCodeNode: async (inputs) => {
      if (seenInputs) seenInputs[node.id] = inputs;
      const fn = runners[node.id];
      if (!fn) throw new Error(`test: no runner for code node "${node.id}"`);
      return (await fn(inputs)) as Record<string, unknown>;
    },
  });
}

describe('runTasklist code nodes', () => {
  it('runs a code node fed by an upstream AGENT node, with output feeding the envelope', async () => {
    const dir = await makeTasklistSpace({
      '01-list.md': `---\nid: list\noutput:\n  items: array\n---\n\nLIST_T: produce the list.`,
      '02-sum.ts': `export const node = { dependsOn: ['list'], output: { total: 'number' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const seen: Record<string, Record<string, unknown>> = {};
    const engine = engineFor(dir, [{ token: 'LIST_T', code: `currentTask.resolve({ items: [1, 2, 3, 4] });` }]);
    const factory = factoryFrom(
      { sum: (inputs) => ({ total: (inputs['list'] as { items: number[] }).items.reduce((a, b) => a + b, 0) }) },
      seen,
    );
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine, seed: { base: 100 }, codeNodeCtxFactory: factory });
    expect(result.data).toEqual({ total: 10 });
    expect(result.ok).toBe(true);
    expect(result.degraded).toBe(false);
    // Inputs mirror what an agent fork would see: seed vars + upstream output keyed by dep id.
    expect(seen['sum']).toEqual({ base: 100, list: { items: [1, 2, 3, 4] } });
  });

  it('fans a code node out over an upstream array (code node AS a forEach body)', async () => {
    const dir = await makeTasklistSpace({
      '01-list.md': `---\nid: list\noutput:\n  items: array\n---\n\nLIST_T: produce the list.`,
      '02-each.ts': `export const node = { dependsOn: ['list'], forEach: 'list.items', goal: true, output: { n: 'number' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, [{ token: 'LIST_T', code: `currentTask.resolve({ items: [10, 20, 30] });` }]);
    const factory = factoryFrom({ each: (inputs) => ({ n: (inputs['item'] as number) * 2 }) });
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine, codeNodeCtxFactory: factory });
    // forEach collects each element's output into an array, in order.
    expect(result.data).toEqual([{ n: 20 }, { n: 40 }, { n: 60 }]);
    expect(result.ok).toBe(true);
  });

  it('lets a code node PRODUCE the array that a downstream forEach code node fans over', async () => {
    // Covers "a code node's array output can drive forEach" with no agent nodes at all.
    const dir = await makeTasklistSpace({
      '01-gen.ts': `export const node = { output: { items: 'array' } };\nexport async function run() { return {}; }`,
      '02-each.ts': `export const node = { dependsOn: ['gen'], forEach: 'gen.items', goal: true, output: { v: 'number' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, []); // no agent nodes
    const factory = factoryFrom({
      gen: () => ({ items: [5, 6] }),
      each: (inputs) => ({ v: inputs['item'] as number }),
    });
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine, codeNodeCtxFactory: factory });
    expect(result.data).toEqual([{ v: 5 }, { v: 6 }]);
  });

  it('propagates a required code node failure as a required-task failure', async () => {
    const dir = await makeTasklistSpace({
      '01-boom.ts': `export const node = { goal: true, output: { v: 'number' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, []);
    const factory = factoryFrom({ boom: () => { throw new Error('kaboom'); } });
    await expect(
      runTasklist({ name: 'flow', space, forkEngine: engine, codeNodeCtxFactory: factory }),
    ).rejects.toThrow(/Required task "boom" failed: kaboom/);
  });

  it('skips an OPTIONAL code node whose run throws, and still completes the goal', async () => {
    const dir = await makeTasklistSpace({
      '01-flaky.ts': `export const node = { optional: true, output: { v: 'number' } };\nexport async function run() { return {}; }`,
      '02-main.md': `---\nid: main\ngoal: true\noutput:\n  v: number\n---\n\nMAIN_T: the real work.`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, [{ token: 'MAIN_T', code: `currentTask.resolve({ v: 7 });` }]);
    const factory = factoryFrom({ flaky: () => { throw new Error('nope'); } });
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine, codeNodeCtxFactory: factory });
    expect(result.data).toEqual({ v: 7 });
    expect(result.ok).toBe(true);
  });

  it('fails a required code node with a clear error when no codeNodeCtxFactory is provided', async () => {
    const dir = await makeTasklistSpace({
      '01-code.ts': `export const node = { goal: true, output: { v: 'number' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, []);
    await expect(
      runTasklist({ name: 'flow', space, forkEngine: engine }),
    ).rejects.toThrow(/Required task "code" failed:.*codeNodeCtxFactory/s);
  });
});

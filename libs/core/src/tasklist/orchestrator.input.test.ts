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
 * A node's own `input:` schema, enforced.
 *
 * It was PARSED (`spaces/tasklist-load.ts` writes `task.input`) and then read by nothing — the only
 * `validateInput` call covered the tasklist-level `index.md` schema against the seed. So a node could
 * declare an input its dependencies never emit and still run, receiving `undefined` and failing later
 * with an error naming the wrong node. Dead contract metadata is worse than none: it reads as a
 * guarantee, and the guarantee is what a reader relies on when wiring a new node into the DAG.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-nodeinput-'));
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

function engineFor(dir: string): ForkEngine {
  const streamFn = createMockStreamFn((_o: StreamOpts) => '');
  return new ForkEngine({
    maxConcurrentForks: 4,
    parentHistory: [],
    parentSpaceDir: dir,
    parentAgentSlug: 'main',
    renderHost: silentHost,
    streamFn,
  });
}

function factoryFrom(runners: Record<string, (inputs: Record<string, unknown>) => unknown>): CodeNodeCtxFactory {
  return (node) => ({
    runCodeNode: async (inputs) => {
      const fn = runners[node.id];
      if (!fn) throw new Error(`test: no runner for code node "${node.id}"`);
      return (await fn(inputs)) as Record<string, unknown>;
    },
  });
}

/** producer → consumer(declares `input:`) . `emits` is what the producer actually resolves. */
async function flow(consumerInput: string, emits: Record<string, unknown>) {
  const dir = await makeTasklistSpace({
    '01-producer.ts': `export const node = { output: { stories: 'array' } };\nexport async function run() { return {}; }`,
    '02-consumer.ts': `export const node = { dependsOn: ['producer'], goal: true, input: ${consumerInput}, output: { done: 'boolean' } };\nexport async function run() { return {}; }`,
  });
  const space = await loadSpace(dir);
  let consumerRan = false;
  const factory = factoryFrom({
    producer: () => emits,
    consumer: () => {
      consumerRan = true;
      return { done: true };
    },
  });
  const run = runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });
  return { run, ran: () => consumerRan };
}

describe('runTasklist — a node\'s own `input:` schema is enforced', () => {
  it('runs the node when its declared input is satisfied', async () => {
    const { run, ran } = await flow(`{ stories: 'array' }`, { stories: ['a', 'b'] });
    await run;
    expect(ran()).toBe(true);
  });

  it('FAILS LOUD when an upstream never emits the declared field', async () => {
    // Previously: consumer ran, got `undefined`, and blew up somewhere downstream with an error
    // that named the wrong node.
    const { run, ran } = await flow(`{ stories: 'array' }`, { somethingElse: 1 });
    await expect(run).rejects.toThrow(/input contract unmet/);
    expect(ran()).toBe(false);
  });

  it('names the node, the missing field AND the dependencies that were supposed to supply it', async () => {
    // The message is the whole debugging surface — a bare "validation failed" would send the reader
    // to the consumer, which is not where the bug is.
    const { run } = await flow(`{ stories: 'array' }`, { somethingElse: 1 });
    await expect(run).rejects.toThrow(/Task "consumer"/);
    await expect(run).rejects.toThrow(/stories/);
    await expect(run).rejects.toThrow(/producer/);
  });

  it('FAILS LOUD on a type mismatch, not just a missing key', async () => {
    const { run } = await flow(`{ stories: 'array' }`, { stories: 'not-an-array' });
    await expect(run).rejects.toThrow(/input contract unmet/);
  });

  it('accepts the field qualified by its producing task id', async () => {
    const { run, ran } = await flow(`{ producer: 'object' }`, { stories: ['a'] });
    await run;
    expect(ran()).toBe(true);
  });

  it('a node that declares no input is unaffected', async () => {
    // The overwhelming majority of shipped nodes. Enforcement must not change their behaviour.
    const dir = await makeTasklistSpace({
      '01-a.ts': `export const node = { output: { x: 'string' } };\nexport async function run() { return {}; }`,
      '02-b.ts': `export const node = { dependsOn: ['a'], goal: true, output: { done: 'boolean' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const out = await runTasklist({
      name: 'flow',
      space,
      forkEngine: engineFor(dir),
      codeNodeCtxFactory: factoryFrom({ a: () => ({ x: 'hi' }), b: () => ({ done: true }) }),
    });
    expect(out).toBeTruthy();
  });

  it('does not flatten a field two dependencies both emit — it must be qualified', async () => {
    // Silently picking one producer's `items` over another's would be a coin-flip the author
    // cannot see. Ambiguity stays unresolved so the contract has to name which one.
    const dir = await makeTasklistSpace({
      '01-left.ts': `export const node = { output: { items: 'array' } };\nexport async function run() { return {}; }`,
      '02-right.ts': `export const node = { output: { items: 'array' } };\nexport async function run() { return {}; }`,
      '03-join.ts': `export const node = { dependsOn: ['left', 'right'], goal: true, input: { items: 'array' }, output: { done: 'boolean' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    await expect(
      runTasklist({
        name: 'flow',
        space,
        forkEngine: engineFor(dir),
        codeNodeCtxFactory: factoryFrom({
          left: () => ({ items: [1] }),
          right: () => ({ items: [2] }),
          join: () => ({ done: true }),
        }),
      }),
    ).rejects.toThrow(/input contract unmet/);
  });
});

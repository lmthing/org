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
 * The scheduler commits each task as it SETTLES, not at the end of a wave.
 *
 * The old loop awaited `Promise.allSettled` over every ready task and committed nothing until the
 * slowest finished, so a node started at *max(finish of the whole previous wave)* rather than max of
 * its own dependencies. In `build_live_project` that made `implement_endpoints` — which needs only
 * `checkpoint_tables` — wait on an unrelated multi-fork fan-out that merely shared its wave.
 *
 * These tests pin the behaviour by TIMING rather than by inspecting internals: a node whose own
 * dependency is finished must start while an unrelated slow sibling is still running.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-rolling-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'main'), { recursive: true });
  await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
  const tl = join(dir, 'tasklists', 'flow');
  await mkdir(tl, { recursive: true });
  for (const [name, contents] of Object.entries(files)) await writeFile(join(tl, name), contents, 'utf8');
  return dir;
}

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

function engineFor(dir: string): ForkEngine {
  const streamFn = createMockStreamFn((_o: StreamOpts) => '');
  return new ForkEngine({ maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main', renderHost: silentHost, streamFn });
}

function factoryFrom(runners: Record<string, () => unknown>): CodeNodeCtxFactory {
  return (node) => ({
    runCodeNode: async () => {
      const fn = runners[node.id];
      if (!fn) throw new Error(`test: no runner for code node "${node.id}"`);
      return (await fn()) as Record<string, unknown>;
    },
  });
}

describe('the scheduler commits each task as it settles', () => {
  it('starts a ready node while an unrelated slow sibling is still running', async () => {
    const dir = await makeTasklistSpace({
      // `quick` and `slow` are both ready at the start. `after` depends ONLY on `quick`, so under a
      // wave barrier it could not begin until `slow` also finished.
      '01-quick.ts': `export const node = { output: { ok: 'boolean' } };\nexport async function run() { return {}; }`,
      '02-slow.ts': `export const node = { output: { ok: 'boolean' } };\nexport async function run() { return {}; }`,
      '03-after.ts': `export const node = { dependsOn: ['quick'], output: { ok: 'boolean' } };\nexport async function run() { return {}; }`,
      '04-done.ts': `export const node = { dependsOn: ['after', 'slow'], goal: true, output: { finished: 'boolean' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    let slowFinished = false;
    let afterStartedBeforeSlowFinished = false;

    const factory = factoryFrom({
      quick: () => ({ ok: true }),
      slow: async () => { await new Promise((r) => setTimeout(r, 200)); slowFinished = true; return { ok: true }; },
      after: () => { afterStartedBeforeSlowFinished = !slowFinished; return { ok: true }; },
      done: () => ({ finished: true }),
    });

    const result = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });

    // THE assertion. Under the previous wave barrier this is false: `after` waited on `slow`.
    expect(afterStartedBeforeSlowFinished).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ finished: true });
  });

  it('still waits for every dependency before starting a node', async () => {
    // The counterpart: committing early must not let a node run before its OWN deps are done.
    const dir = await makeTasklistSpace({
      '01-a.ts': `export const node = { output: { ok: 'boolean' } };\nexport async function run() { return {}; }`,
      '02-b.ts': `export const node = { output: { ok: 'boolean' } };\nexport async function run() { return {}; }`,
      '03-both.ts': `export const node = { dependsOn: ['a', 'b'], goal: true, output: { seen: 'array' } };\nexport async function run() { return {}; }`,
    });
    const space = await loadSpace(dir);
    const finished: string[] = [];
    const factory = factoryFrom({
      a: async () => { await new Promise((r) => setTimeout(r, 120)); finished.push('a'); return { ok: true }; },
      b: () => { finished.push('b'); return { ok: true }; },
      both: () => ({ seen: [...finished] }),
    });

    const result = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir), codeNodeCtxFactory: factory });

    expect(result.ok).toBe(true);
    // `both` must observe BOTH predecessors, in whatever order they settled.
    expect(((result.data as { seen: string[] }).seen ?? []).sort()).toEqual(['a', 'b']);
  });
});

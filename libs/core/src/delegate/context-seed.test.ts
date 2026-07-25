import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDelegate } from './delegate.js';
import { DelegateRegistry } from './registry.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * A delegate exposes its `query` and `context` seed as REAL VM variables, so an agent
 * can pass structured data handed down by the delegator straight into its tasklist —
 * this is what lets THING deep-research a domain and hand the cited report to the
 * architect via `context.research` (instead of re-serializing it from prose).
 */

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };
const tmpDirs: string[] = [];
afterAll(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))); });

async function makeAgentSpace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-ctxseed-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'builder'), { recursive: true });
  await writeFile(join(dir, 'agents', 'builder', 'instruct.md'), 'You are a builder.\n', 'utf8');
  return dir;
}

describe('delegate exposes query/context as VM variables', () => {
  it('an agent can read context.research (structured seed) and resolve with it', async () => {
    const dir = await makeAgentSpace();
    const space = await loadSpace(dir);
    const registry = new DelegateRegistry(new Map([[dir, space]]));

    const streamFn = createMockStreamFn((_o: StreamOpts) =>
      // References the injected `query` and `context` variables directly.
      `currentTask.resolve({ gotQuery: query, topic: context.research.topic, findingCount: context.research.findings.length });`,
    );

    const result = (await runDelegate({
      packageName: dir,
      agentName: 'builder',
      registry,
      renderHost: silentHost,
      streamFn,
      depth: 0,
      maxDepth: 5,
      maxConcurrentForks: 4,
      delegateOpts: {
        query: 'build a composting advisor',
        context: { research: { topic: 'home composting', findings: [{ heading: 'a' }, { heading: 'b' }] } },
      },
    })) as { gotQuery: string; topic: string; findingCount: number };

    expect(result.gotQuery).toBe('build a composting advisor');
    expect(result.topic).toBe('home composting');
    expect(result.findingCount).toBe(2);
  });
});

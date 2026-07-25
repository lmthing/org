import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { runTasklist } from './orchestrator.js';
import { ForkEngine } from '../fork/fork.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * End-to-end coverage for the `plan -> investigate (forEach) -> synthesize` shape
 * that `system-research`'s `deep_research` tasklist uses — a gap the system-space
 * authoring notes flagged ("no dedicated tests for deep_research tasklist logic").
 * Mirrors the real
 * tasklist's structure with a stand-in `fetcher` space function that, like
 * `webSearch`/`webFetch`, internally `await fetch(...)`s — a yield NESTED inside
 * another async function. `fetcher`'s return value (`{ tag, status }`) is shaped
 * so that binding the raw inner `fetch()` result instead of `fetcher`'s own
 * processed return (the bug fixed in turn-loop's post-yield binding) would be
 * immediately visible: the raw fetch response has no `tag` field.
 */

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function makeDeepResearchShapedSpace(port: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-deepresearch-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'researcher'), { recursive: true });
  await writeFile(join(dir, 'agents', 'researcher', 'instruct.md'), 'You are a researcher.\n', 'utf8');

  await mkdir(join(dir, 'functions'), { recursive: true });
  // Mirrors webSearch/webFetch's shape: a plain async function that internally
  // awaits the (now yield-based) `fetch` global, then post-processes the result.
  await writeFile(
    join(dir, 'functions', 'fetcher.ts'),
    [
      'export async function fetcher(q: string): Promise<{ tag: string; status: number }> {',
      `  const r = await fetch('http://127.0.0.1:${port}/?q=' + encodeURIComponent(q));`,
      '  return { tag: `processed:${q}`, status: r.status };',
      '}',
    ].join('\n'),
    'utf8',
  );

  const tl = join(dir, 'tasklists', 'deep_research');
  await mkdir(tl, { recursive: true });
  await writeFile(join(tl, 'index.md'), '---\ninput:\n  query: string\n---\n\nGOAL: produce a report.', 'utf8');
  await writeFile(
    join(tl, '01-plan.md'),
    '---\nid: plan\noutput:\n  questions: array\ndependsOn: []\nrole: explore\nfunctions: []\n---\n\nPLAN_T: decompose the query.',
    'utf8',
  );
  await writeFile(
    join(tl, '02-investigate.md'),
    [
      '---',
      'id: investigate',
      'output:',
      '  question: string',
      '  tag: string',
      '  status: number',
      'dependsOn: [plan]',
      'forEach: plan.questions',
      'role: explore',
      'functions:',
      '  - fetcher',
      '---',
      '',
      'INVESTIGATE_T: investigate one question.',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(tl, '03-synthesize.md'),
    '---\nid: synthesize\noutput:\n  count: number\n  tags: array\ngoal: true\ndependsOn: [plan, investigate]\nrole: explore\nfunctions: []\n---\n\nSYNTHESIZE_T: roll up the investigations.',
    'utf8',
  );
  return dir;
}

describe('deep_research-shaped tasklist (plan -> investigate forEach -> synthesize)', () => {
  it('propagates each investigate fork\'s OWN processed return value (not the raw nested fetch) into synthesize', async () => {
    // A local server records each request's arrival time (to also prove the forEach
    // fan-out's fetches run concurrently, not serialized) and answers 200.
    const arrivals: number[] = [];
    const server: Server = createServer((_req, res) => {
      arrivals.push(Date.now());
      setTimeout(() => res.end('ok'), 50);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const dir = await makeDeepResearchShapedSpace(port);
      const space = await loadSpace(dir);

      const seen: string[] = [];
      const streamFn = createMockStreamFn((o: StreamOpts) => {
        const user = o.messages.map((m) => m.content).join('\n');
        if (user.includes('PLAN_T')) {
          seen.push('plan');
          return `currentTask.resolve({ questions: ["q1", "q2", "q3"] });`;
        }
        if (user.includes('INVESTIGATE_T')) {
          // `fetcher` yields (nested inside its own `await fetch(...)`), so the turn
          // aborts right after that statement — the resolve must wait for the NEXT
          // turn, once `r` is bound. Detect which turn this is from whether the
          // fetcher call already appears in this fork's accumulated history.
          if (user.includes('await fetcher(')) {
            return 'currentTask.resolve({ question, tag: r.tag, status: r.status });';
          }
          seen.push('investigate');
          // `item` is the forEach element (one planned question). `fetcher` is a
          // nested yield (awaits the yield-based `fetch` global internally) — this
          // is exactly the shape that exposed the turn-loop binding bug.
          return [
            'const question = String(item);',
            'const r = await fetcher(question);',
          ].join('\n');
        }
        if (user.includes('SYNTHESIZE_T')) {
          seen.push('synthesize');
          return [
            'currentTask.resolve({',
            '  count: investigate.length,',
            '  tags: investigate.map((r: { tag: string }) => r.tag),',
            '});',
          ].join('\n');
        }
        return '';
      });

      const engine = new ForkEngine({
        maxConcurrentForks: 4,
        parentHistory: [],
        parentSpaceDir: dir,
        parentAgentSlug: 'researcher',
        renderHost: silentHost,
        streamFn,
        agentFunctions: space.functions,
        agentFunctionsBundled: space.functionsBundled,
      });

      const env = await runTasklist({
        name: 'deep_research',
        space,
        forkEngine: engine,
        seed: { query: 'test topic' },
      });
      expect(env.ok).toBe(true);
      expect(env.degraded).toBe(false);
      const goal = env.data as { count: number; tags: string[] };

      expect(seen.filter((s) => s === 'investigate')).toHaveLength(3);
      expect(goal.count).toBe(3);
      // Each tag is `fetcher`'s OWN processed value ("processed:qN") — not the raw
      // fetch() response (which has no `tag` field at all). A binding regression
      // would surface here as `undefined` entries.
      expect(goal.tags.sort()).toEqual(['processed:q1', 'processed:q2', 'processed:q3']);

      // The 3 forEach forks' fetches reached the server within a tight window of
      // each other — proving they ran concurrently (within maxConcurrentForks),
      // not serialized one-by-one.
      expect(arrivals.length).toBe(3);
      expect(Math.max(...arrivals) - Math.min(...arrivals)).toBeLessThan(100);
    } finally {
      server.close();
    }
  });
});

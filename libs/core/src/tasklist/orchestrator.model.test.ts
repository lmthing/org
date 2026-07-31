import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTasklist } from './orchestrator.js';
import { ForkEngine } from '../fork/fork.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * Per-node `model:` end-to-end through the REAL orchestrator + ForkEngine with the
 * scripted mock provider (no API keys): a node that declares `model:` runs its turns
 * on that model, a node that declares none falls back down the chain
 * (`task.model ?? modelForRole(task.role, roleModels) ?? defaultModel`) — which is
 * what lets one expensive step be pinned strong while the rest run the pod default.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-orchmodel-'));
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

/** Two-node tasklist: `a` pins a model, `b` (the goal) declares none. */
const TWO_NODES = {
  '01-a.md': `---\nid: a\nmodel: model-a\noutput:\n  v: number\n---\n\nA_T: the pinned step.`,
  '02-b.md': `---\nid: b\ngoal: true\noutput:\n  v: number\n---\n\nB_T: the default step.`,
};

/**
 * Run the two-node tasklist, recording the `model` of every streamFn call against
 * the task token that call's prompt carries. Returns token -> models seen.
 */
async function runAndCaptureModels(engineOpts: {
  roleModels?: Record<string, string>;
  defaultModel?: string;
}): Promise<Record<string, Array<string | undefined>>> {
  const dir = await makeTasklistSpace(TWO_NODES);
  const space = await loadSpace(dir);
  const byToken: Record<string, Array<string | undefined>> = { A_T: [], B_T: [] };
  const streamFn = createMockStreamFn((o: StreamOpts) => {
    const user = o.messages.map((m) => m.content).join('\n');
    for (const token of ['A_T', 'B_T']) {
      if (user.includes(token)) {
        byToken[token]!.push(o.model);
        return `currentTask.resolve({ v: 1 });`;
      }
    }
    return '';
  });
  const engine = new ForkEngine({
    maxConcurrentForks: 4,
    parentHistory: [],
    parentSpaceDir: dir,
    parentAgentSlug: 'main',
    renderHost: silentHost,
    streamFn,
    ...engineOpts,
  });
  const goal = await runTasklist({ name: 'flow', space, forkEngine: engine });
  expect(goal.ok).toBe(true);
  return byToken;
}

describe('tasklist per-node model', () => {
  it('runs a node with `model:` on THAT model and a node without it on the engine default', async () => {
    const seen = await runAndCaptureModels({ defaultModel: 'default-model' });
    expect(seen['A_T']).not.toHaveLength(0);
    expect(seen['B_T']).not.toHaveLength(0);
    expect(new Set(seen['A_T'])).toEqual(new Set(['model-a']));
    expect(new Set(seen['B_T'])).toEqual(new Set(['default-model']));
  });

  it("a node's own `model:` WINS over the role model; a node without one still takes the role model", async () => {
    // Neither node declares a role → both are 'general', so the general role model is
    // what the unpinned node falls back to. The pinned node must ignore it.
    const seen = await runAndCaptureModels({
      roleModels: { general: 'role-model' },
      defaultModel: 'default-model',
    });
    expect(new Set(seen['A_T'])).toEqual(new Set(['model-a']));
    expect(new Set(seen['B_T'])).toEqual(new Set(['role-model']));
  });
});

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTasklist, type CheckpointSnapshot } from './orchestrator.js';
import { ForkEngine } from '../fork/fork.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * Coverage for the W8 tasklist-engine additions: `kind:'subgraph'` (run a named
 * sub-tasklist and unwrap its envelope), `forEach` over a subgraph (fan a whole
 * sub-DAG out over a runtime-produced array — the slice-per-item pipeline), and
 * `kind:'checkpoint'` (a durable resume barrier). Drives the REAL runTasklist +
 * ForkEngine with the scripted mock provider — no API keys.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

/** Write a space with one `main` agent and one or more named tasklists. */
async function makeSpace(tasklists: Record<string, Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-subgraph-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'agents', 'main'), { recursive: true });
  await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
  for (const [tlName, files] of Object.entries(tasklists)) {
    const tl = join(dir, 'tasklists', tlName);
    await mkdir(tl, { recursive: true });
    for (const [n, c] of Object.entries(files)) await writeFile(join(tl, n), c, 'utf8');
  }
  return dir;
}

const silentHost: RenderHost = { display: () => {}, ask: async () => undefined, log: () => {} };

function engineFor(dir: string, streamFn: ReturnType<typeof createMockStreamFn>): ForkEngine {
  return new ForkEngine({
    maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
    renderHost: silentHost, streamFn,
  });
}

describe('subgraph node', () => {
  it('runs a named sub-tasklist and unwraps its envelope.data as the node output', async () => {
    const dir = await makeSpace({
      flow: {
        '01-seed.md': `---\nid: seed\noutput:\n  n: number\n---\n\nSEED_T: emit the number.`,
        '02-slice.md': `---\nid: slice\ndependsOn: [seed]\nsubgraph: doubler\ngoal: true\noutput:\n  doubled: number\n---\n\n(subgraph node — no body)`,
      },
      doubler: {
        '01-double.md': `---\nid: double\ngoal: true\noutput:\n  doubled: number\n---\n\nDOUBLE_T: double the seeded n.`,
      },
    });
    const space = await loadSpace(dir);
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('SEED_T')) return `currentTask.resolve({ n: 5 });`;
      // The child fork sees the parent node's upstream output (`seed`) as a bound var.
      if (user.includes('DOUBLE_T')) return `currentTask.resolve({ doubled: seed.n * 2 });`;
      return '';
    });
    const goal = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir, streamFn) });
    expect(goal.data).toEqual({ doubled: 10 });
    expect(goal.ok).toBe(true);
    expect(goal.degraded).toBe(false);
  });

  it('fans a subgraph out once per element of a runtime-produced array (dynamic slices)', async () => {
    const dir = await makeSpace({
      flow: {
        '01-plan.md': `---\nid: plan\noutput:\n  slices: array\n---\n\nPLAN_T: discover the slices at runtime.`,
        '02-build.md': `---\nid: build\ndependsOn: [plan]\nforEach: plan.slices\nsubgraph: slicebuild\ngoal: true\noutput:\n  label: string\n---\n\n(subgraph fan-out)`,
      },
      slicebuild: {
        '01-mk.md': `---\nid: mk\ngoal: true\noutput:\n  label: string\n---\n\nMK_T: label the slice from its item.`,
      },
    });
    const space = await loadSpace(dir);
    let mkRuns = 0;
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('PLAN_T')) return `currentTask.resolve({ slices: [{ k: 'a' }, { k: 'b' }, { k: 'c' }] });`;
      if (user.includes('MK_T')) { mkRuns++; return `currentTask.resolve({ label: item.k.toUpperCase() });`; }
      return '';
    });
    const goal = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir, streamFn) });
    // Each slice ran its own sub-tasklist; the collected array is the goal output.
    expect(goal.data).toEqual([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
    expect(mkRuns).toBe(3);
    expect(goal.ok).toBe(true);
  });

  it('folds a degraded sub-run up into the boundary envelope, re-labelled', async () => {
    const dir = await makeSpace({
      flow: {
        '01-slice.md': `---\nid: slice\nsubgraph: flaky\ngoal: true\noutput:\n  v: number\n---\n\n(subgraph node)`,
      },
      flaky: {
        // The child's goal never resolves on-schema → salvaged → child envelope ok:false.
        '01-inner.md': `---\nid: inner\ngoal: true\noutput:\n  v: number\n---\n\nINNER_T: never resolves cleanly.`,
      },
    });
    const space = await loadSpace(dir);
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('INNER_T')) return `// no resolve — force a salvage`;
      return '';
    });
    const goal = await runTasklist({ name: 'flow', space, forkEngine: engineFor(dir, streamFn) });
    expect(goal.ok).toBe(false); // the subgraph is the goal, and its sub-run degraded
    expect(goal.degraded).toBe(true);
    // The inner salvage is surfaced under the parent node's id.
    expect(goal.degradedTasks).toContain('slice');
    expect(goal.degradedTasks?.some((t) => t.startsWith('slice/'))).toBe(true);
  });
});

describe('checkpoint node + resume', () => {
  it('fires onCheckpoint with a snapshot of everything done so far', async () => {
    const dir = await makeSpace({
      flow: {
        '01-a.md': `---\nid: a\noutput:\n  v: number\n---\n\nA_T: first step.`,
        '02-cp.md': `---\nid: cp\ndependsOn: [a]\ncheckpoint: true\n---\n\n(checkpoint barrier)`,
        '03-b.md': `---\nid: b\ndependsOn: [cp]\ngoal: true\noutput:\n  w: number\n---\n\nB_T: after the checkpoint.`,
      },
    });
    const space = await loadSpace(dir);
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('A_T')) return `currentTask.resolve({ v: 1 });`;
      if (user.includes('B_T')) return `currentTask.resolve({ w: 2 });`;
      return '';
    });
    const snapshots: CheckpointSnapshot[] = [];
    const goal = await runTasklist({
      name: 'flow', space, forkEngine: engineFor(dir, streamFn),
      onCheckpoint: (cp) => { snapshots.push(cp); },
    });
    expect(goal.data).toEqual({ w: 2 });
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.tasklist).toBe('flow');
    expect(snap.id).toBe('cp');
    expect(snap.done).toEqual(expect.arrayContaining(['a', 'cp']));
    expect(snap.done).not.toContain('b'); // b runs AFTER the checkpoint
    expect(snap.outputs['a']).toEqual({ v: 1 });
  });

  it('resumes from a checkpoint, skipping tasks already done', async () => {
    const files = {
      flow: {
        '01-a.md': `---\nid: a\noutput:\n  v: number\n---\n\nA_T: first step.`,
        '02-cp.md': `---\nid: cp\ndependsOn: [a]\ncheckpoint: true\n---\n\n(checkpoint barrier)`,
        '03-b.md': `---\nid: b\ndependsOn: [cp]\ngoal: true\noutput:\n  w: number\n---\n\nB_T: after the checkpoint.`,
      },
    };
    const dir = await makeSpace(files);
    const space = await loadSpace(dir);

    // First run: capture the checkpoint.
    const snapshots: CheckpointSnapshot[] = [];
    const firstFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('A_T')) return `currentTask.resolve({ v: 1 });`;
      if (user.includes('B_T')) return `currentTask.resolve({ w: 2 });`;
      return '';
    });
    await runTasklist({
      name: 'flow', space, forkEngine: engineFor(dir, firstFn),
      onCheckpoint: (cp) => { snapshots.push(cp); },
    });
    const snap = snapshots[0]!;

    // Resume run: `a` must NOT re-run; only `b` does.
    let aRanAgain = false;
    const resumeFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('A_T')) { aRanAgain = true; return `currentTask.resolve({ v: 99 });`; }
      if (user.includes('B_T')) return `currentTask.resolve({ w: 2 });`;
      return '';
    });
    const goal = await runTasklist({
      name: 'flow', space, forkEngine: engineFor(dir, resumeFn),
      resume: { done: snap.done, outputs: snap.outputs },
    });
    expect(aRanAgain).toBe(false); // pre-checkpoint work skipped
    expect(goal.data).toEqual({ w: 2 });
  });
});

describe('subgraph validation', () => {
  it('rejects a subgraph naming a tasklist that would recurse into itself', async () => {
    const dir = await makeSpace({
      flow: {
        '01-x.md': `---\nid: x\nsubgraph: flow\ngoal: true\noutput:\n  v: number\n---\n\n(self-subgraph)`,
      },
    });
    const space = await loadSpace(dir);
    const streamFn = createMockStreamFn(() => '');
    await expect(runTasklist({ name: 'flow', space, forkEngine: engineFor(dir, streamFn) }))
      .rejects.toThrow(/recurse|cycle/i);
  });

  it('rejects a subgraph naming a tasklist that does not exist', async () => {
    const dir = await makeSpace({
      flow: {
        '01-s.md': `---\nid: s\nsubgraph: nope\ngoal: true\noutput:\n  v: number\n---\n\n(missing target)`,
      },
    });
    const space = await loadSpace(dir);
    const streamFn = createMockStreamFn(() => '');
    await expect(runTasklist({ name: 'flow', space, forkEngine: engineFor(dir, streamFn) }))
      .rejects.toThrow(/not a tasklist/i);
  });

  it('rejects a node declaring both subgraph and checkpoint', async () => {
    const dir = await makeSpace({
      flow: {
        '01-bad.md': `---\nid: bad\nsubgraph: other\ncheckpoint: true\ngoal: true\noutput:\n  v: number\n---\n\n(illegal)`,
      },
      other: {
        '01-o.md': `---\nid: o\ngoal: true\noutput:\n  v: number\n---\n\nO_T: x.`,
      },
    });
    const space = await loadSpace(dir);
    const streamFn = createMockStreamFn(() => '');
    await expect(runTasklist({ name: 'flow', space, forkEngine: engineFor(dir, streamFn) }))
      .rejects.toThrow(/either a "subgraph" or a "checkpoint"/i);
  });
});

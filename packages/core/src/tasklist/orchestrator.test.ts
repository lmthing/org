import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTasklist } from './orchestrator.js';
import { ForkEngine } from '../fork/fork.js';
import { loadSpace } from '../spaces/load.js';
import { createMockStreamFn } from '../testing/mock-provider.js';
import { Tracer } from '../sandbox/trace.js';
import type { TraceEvent } from '../sandbox/trace.js';
import type { RenderHost } from '../session/types.js';
import type { StreamOpts } from '../eval/stream-types.js';

/**
 * Orchestrator branch coverage: drives the REAL runTasklist + ForkEngine with the
 * scripted mock provider (no API keys). Exercises the scheduling paths that the
 * happy-path session test in testing/harness-features.test.ts doesn't reach —
 * parallel-ready fan-out, optional-task skip on failure, condition skip, and the
 * required-task-failure throw.
 */

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Write a one-agent space whose `flow` tasklist is the given { filename: contents } map. */
async function makeTasklistSpace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lmthing-orch-'));
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

/** ForkEngine wired to a mock streamFn; `seen` records every task token the mock answered. */
function engineFor(
  dir: string,
  answers: Array<{ token: string; code: string }>,
  seen: string[],
  budgetLimits?: Record<string, number>,
): ForkEngine {
  const streamFn = createMockStreamFn((o: StreamOpts) => {
    const user = o.messages.map((m) => m.content).join('\n');
    for (const a of answers) {
      if (user.includes('Output schema:') && user.includes(a.token)) {
        seen.push(a.token);
        return a.code;
      }
    }
    // A task with no scripted answer never resolves. The fork salvages a schema-valid
    // placeholder (graceful degradation) UNLESS a hard budget cap forces a real failure.
    return budgetLimits ? `await sleep("1ms");` : '';
  });
  return new ForkEngine({
    maxConcurrentForks: 4,
    parentHistory: [],
    parentSpaceDir: dir,
    parentAgentSlug: 'main',
    renderHost: silentHost,
    streamFn,
    ...(budgetLimits ? { budgetLimits } : {}),
  });
}

describe('runTasklist orchestrator', () => {
  it('fans out independent ready tasks in parallel and seeds every task', async () => {
    // left + right have no deps → both are ready in the first scheduling round.
    const dir = await makeTasklistSpace({
      '01-left.md': `---\nid: left\noutput:\n  v: number\n---\n\nLEFT_T: derive from seed.`,
      '02-right.md': `---\nid: right\ngoal: true\noutput:\n  v: number\n---\n\nRIGHT_T: derive from seed.`,
    });
    const space = await loadSpace(dir);
    const seen: string[] = [];
    const engine = engineFor(
      dir,
      [
        { token: 'LEFT_T', code: `currentTask.resolve({ v: base + 1 });` },
        { token: 'RIGHT_T', code: `currentTask.resolve({ v: base + 2 });` },
      ],
      seen,
    );
    const goal = await runTasklist({ name: 'flow', space, forkEngine: engine, seed: { base: 10 } });
    // Both ready tasks ran (seed reached both); the goal task's output is returned.
    expect(seen.sort()).toEqual(['LEFT_T', 'RIGHT_T']);
    expect(goal).toEqual({ v: 12 });
  });

  it('skips an optional task whose fork fails, and still completes the goal', async () => {
    const dir = await makeTasklistSpace({
      '01-flaky.md': `---\nid: flaky\noptional: true\noutput:\n  v: number\n---\n\nFLAKY_T: this one never resolves.`,
      '02-main.md': `---\nid: main\ngoal: true\noutput:\n  v: number\n---\n\nMAIN_T: the real work.`,
    });
    const space = await loadSpace(dir);
    const seen: string[] = [];
    // flaky has no scripted answer → its fork rejects → optional → skipped (no throw).
    const engine = engineFor(dir, [{ token: 'MAIN_T', code: `currentTask.resolve({ v: 5 });` }], seen);
    const goal = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(goal).toEqual({ v: 5 });
    expect(seen).toEqual(['MAIN_T']); // main ran; the flaky fork produced no answer
  });

  it('skips a task whose condition is not met (its fork never runs)', async () => {
    const dir = await makeTasklistSpace({
      '01-gate.md': `---\nid: gate\noutput:\n  go: boolean\n---\n\nGATE_T: decide the gate.`,
      '02-branch.md': `---\nid: branch\ndependsOn:\n  - gate\ncondition: "gate.go == true"\noutput:\n  v: number\n---\n\nBRANCH_T: only when gate is open.`,
      '03-final.md': `---\nid: final\ndependsOn:\n  - gate\ngoal: true\noutput:\n  v: number\n---\n\nFINAL_T: always the goal.`,
    });
    const space = await loadSpace(dir);
    const seen: string[] = [];
    const engine = engineFor(
      dir,
      [
        { token: 'GATE_T', code: `currentTask.resolve({ go: false });` }, // gate closed
        { token: 'BRANCH_T', code: `currentTask.resolve({ v: 1 });` },
        { token: 'FINAL_T', code: `currentTask.resolve({ v: 9 });` },
      ],
      seen,
    );
    const goal = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(goal).toEqual({ v: 9 });
    // The conditional branch was skipped — its fork was never dispatched.
    expect(seen).toContain('GATE_T');
    expect(seen).toContain('FINAL_T');
    expect(seen).not.toContain('BRANCH_T');
  });

  it('throws (not silent undefined) when the goal task is skipped, folding in upstream errors', async () => {
    // Regression for the architect "returned null" failure: build fails validation →
    // register's `build.ok == true` condition skips it → the goal task (execute), which
    // depends on register, is skipped too. Previously runTasklist returned `undefined`,
    // surfacing to the caller as a silent `null`. Now it throws with the upstream reason.
    const dir = await makeTasklistSpace({
      '01-build.md': `---\nid: build\noutput:\n  ok: boolean\n  errors: string\n---\n\nBUILD_T: build + validate.`,
      '02-register.md': `---\nid: register\ndependsOn:\n  - build\ncondition: "build.ok == true"\noutput:\n  spaceKey: string\n---\n\nREG_T: register the space.`,
      '03-execute.md': `---\nid: execute\ndependsOn:\n  - register\ngoal: true\ncondition: "register.spaceKey != ''"\noutput:\n  v: number\n---\n\nEXEC_T: the goal.`,
    });
    const space = await loadSpace(dir);
    const seen: string[] = [];
    const engine = engineFor(
      dir,
      [
        { token: 'BUILD_T', code: `currentTask.resolve({ ok: false, errors: 'validation failed: knowledge missing' });` },
        { token: 'REG_T', code: `currentTask.resolve({ spaceKey: 'k' });` },
        { token: 'EXEC_T', code: `currentTask.resolve({ v: 1 });` },
      ],
      seen,
    );
    await expect(runTasklist({ name: 'flow', space, forkEngine: engine })).rejects.toThrow(
      /goal task "execute" was skipped.*validation failed: knowledge missing/s,
    );
    // The downstream tasks never ran — only build was dispatched.
    expect(seen).toEqual(['BUILD_T']);
  });

  it('emits a tasklist node with per-task children (done + skipped) when given a tracer', async () => {
    const dir = await makeTasklistSpace({
      '01-gate.md': `---\nid: gate\noutput:\n  go: boolean\n---\n\nGATE_T: decide the gate.`,
      '02-branch.md': `---\nid: branch\ndependsOn:\n  - gate\ncondition: "gate.go == true"\noutput:\n  v: number\n---\n\nBRANCH_T: only when gate is open.`,
      '03-final.md': `---\nid: final\ndependsOn:\n  - gate\ngoal: true\noutput:\n  v: number\n---\n\nFINAL_T: always the goal.`,
    });
    const space = await loadSpace(dir);
    const seen: string[] = [];
    const events: TraceEvent[] = [];
    const tracer = new Tracer(null);
    tracer.subscribe((e) => events.push(e));
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, tracer,
      streamFn: createMockStreamFn((o: StreamOpts) => {
        const user = o.messages.map((m) => m.content).join('\n');
        for (const a of [
          { token: 'GATE_T', code: `currentTask.resolve({ go: false });` },
          { token: 'FINAL_T', code: `currentTask.resolve({ v: 9 });` },
        ]) {
          if (user.includes('Output schema:') && user.includes(a.token)) { seen.push(a.token); return a.code; }
        }
        return '';
      }),
    });
    const parentScope = tracer.child(undefined, 'run', 'session');
    await runTasklist({ name: 'flow', space, forkEngine: engine, tracer, parentScope });

    const starts = events.filter((e): e is Extract<TraceEvent, { type: 'node_start' }> => e.type === 'node_start');
    const ends = events.filter((e): e is Extract<TraceEvent, { type: 'node_end' }> => e.type === 'node_end');

    // One tasklist node, parented under the run scope.
    const tasklistNode = starts.find((s) => s.kind === 'tasklist');
    expect(tasklistNode).toBeDefined();
    expect(tasklistNode!.parentId).toBe(parentScope.nodeId);

    // Task nodes nest under the tasklist node; gate/final done, branch skipped.
    const taskNodes = starts.filter((s) => s.kind === 'task');
    expect(taskNodes.every((t) => t.parentId === tasklistNode!.nodeId)).toBe(true);
    const branch = taskNodes.find((t) => t.label.includes('branch'));
    expect(branch!.detail?.dependsOn).toContain('gate');
    const branchEnd = ends.find((e) => e.nodeId === branch!.nodeId);
    expect(branchEnd!.status).toBe('skipped');
    // The tasklist node itself completed.
    expect(ends.find((e) => e.nodeId === tasklistNode!.nodeId)!.status).toBe('done');
  });

  it('salvages a never-resolving required task so the tasklist still completes', async () => {
    // Robustness contract: a required task whose fork never calls resolve() is salvaged
    // (schema-valid placeholder) rather than aborting the whole tasklist. This is the
    // graceful-degradation path — a partial/empty result beats total failure.
    const dir = await makeTasklistSpace({
      '01-boom.md': `---\nid: boom\ngoal: true\noutput:\n  v: number\n---\n\nBOOM_T: this required task never resolves.`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, [], []); // no answer → boom's fork salvages
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(result).toMatchObject({ v: 0 }); // salvaged number placeholder
  });

  it('throws when a required task hits a hard budget cap (genuine failure)', async () => {
    // A hard limit (budget) is NOT salvaged — it propagates so a runaway task fails loudly.
    const dir = await makeTasklistSpace({
      '01-boom.md': `---\nid: boom\ngoal: true\noutput:\n  v: number\n---\n\nBOOM_T: this required task loops forever.`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, [], [], { maxEpisodes: 3 }); // loops on sleep → budget cap fires
    await expect(runTasklist({ name: 'flow', space, forkEngine: engine })).rejects.toThrow(
      /Required task "boom" failed/,
    );
  });

  it('with no goal: true task, resolves the effective goal to the LAST task (file order)', async () => {
    // Neither task declares goal: true — the effective goal falls back to the
    // last task in file order (02-second), not the first.
    const dir = await makeTasklistSpace({
      '01-first.md': `---\nid: first\noutput:\n  v: number\n---\n\nFIRST_T: runs first, not the goal.`,
      '02-second.md': `---\nid: second\ndependsOn:\n  - first\noutput:\n  v: number\n---\n\nSECOND_T: runs last, is the effective goal.`,
    });
    const space = await loadSpace(dir);
    const seen: string[] = [];
    const engine = engineFor(
      dir,
      [
        { token: 'FIRST_T', code: `currentTask.resolve({ v: 1 });` },
        { token: 'SECOND_T', code: `currentTask.resolve({ v: 2 });` },
      ],
      seen,
    );
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(result).toEqual({ v: 2 });
    expect(seen).toEqual(['FIRST_T', 'SECOND_T']);
  });

  it('throws when two tasks declare goal: true', async () => {
    const dir = await makeTasklistSpace({
      '01-a.md': `---\nid: a\ngoal: true\noutput:\n  v: number\n---\n\nA_T: first goal.`,
      '02-b.md': `---\nid: b\ngoal: true\noutput:\n  v: number\n---\n\nB_T: second goal.`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, [], []);
    await expect(runTasklist({ name: 'flow', space, forkEngine: engine })).rejects.toThrow(
      /multiple goal tasks/,
    );
  });

  it('validates the seed against the tasklist index.md input schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lmthing-orch-'));
    tmpDirs.push(dir);
    await mkdir(join(dir, 'agents', 'main'), { recursive: true });
    await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
    const tl = join(dir, 'tasklists', 'flow');
    await mkdir(tl, { recursive: true });
    await writeFile(
      join(tl, 'index.md'),
      `---\ninput:\n  topic: string\n---\n\nDescribes the flow tasklist.`,
      'utf8',
    );
    await writeFile(
      join(tl, '01-main.md'),
      `---\nid: main\ngoal: true\noutput:\n  v: number\n---\n\nMAIN_T: the real work.`,
      'utf8',
    );
    const space = await loadSpace(dir);
    const seen: string[] = [];
    const engine = engineFor(dir, [{ token: 'MAIN_T', code: `currentTask.resolve({ v: 5 });` }], seen);

    // Missing the required "topic" field — should throw a clear, actionable error.
    await expect(
      runTasklist({ name: 'flow', space, forkEngine: engine, seed: { other: 1 } }),
    ).rejects.toThrow(/topic/);

    // Wrong type for "topic" — should also throw.
    await expect(
      runTasklist({ name: 'flow', space, forkEngine: engine, seed: { topic: 42 } }),
    ).rejects.toThrow(/topic/);

    // A valid seed is accepted and the tasklist runs to completion.
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine, seed: { topic: 'pasta' } });
    expect(result).toEqual({ v: 5 });
  });
});

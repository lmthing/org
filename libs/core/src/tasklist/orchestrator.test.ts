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
    // Both ready tasks ran (seed reached both); the goal task's output is the envelope payload.
    expect(seen.sort()).toEqual(['LEFT_T', 'RIGHT_T']);
    expect(goal.data).toEqual({ v: 12 });
    expect(goal.ok).toBe(true);
    expect(goal.degraded).toBe(false);
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
    expect(goal.data).toEqual({ v: 5 });
    expect(goal.ok).toBe(true); // the GOAL task itself resolved cleanly
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
    expect(goal.data).toEqual({ v: 9 });
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

  it('salvages a never-resolving required task so the tasklist still completes, signalled via the envelope', async () => {
    // Robustness contract: a required task whose fork never calls resolve() is salvaged
    // (NEUTRAL schema-valid placeholder) rather than aborting the whole tasklist. The
    // degradation is a TYPED signal on the envelope — never prose inside the data.
    const dir = await makeTasklistSpace({
      '01-boom.md': `---\nid: boom\ngoal: true\noutput:\n  v: number\n  note: string\n---\n\nBOOM_T: this required task never resolves.`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, [], []); // no answer → boom's fork salvages
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(result.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('no_resolve');
    expect(result.degradedTasks).toEqual(['boom']);
    expect(result.data).toEqual({ v: 0, note: '' }); // neutral empties, schema-shaped
    // The alarming prose placeholder is GONE from the data plane entirely.
    expect(JSON.stringify(result)).not.toContain('(unavailable');
  });

  it('labels a degraded forEach ELEMENT as "task[i]" in degradedTasks', async () => {
    // Only element index 2 (item 30) never resolves — its fork salvages. The envelope
    // must name exactly that element, and the goal (a forEach task) counts as degraded.
    const dir = await makeTasklistSpace({
      '01-list.md': `---\nid: list\noutput:\n  items: array\n---\n\nLIST_T: produce the list.`,
      '02-each.md': `---\nid: each\ndependsOn: [list]\nforEach: list.items\ngoal: true\noutput:\n  n: number\n---\n\nEACH_T: process one item.`,
    });
    const space = await loadSpace(dir);
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('LIST_T')) return `currentTask.resolve({ items: [10, 20, 30] });`;
      if (user.includes('EACH_T')) {
        if (user.includes('- item: 30')) return ''; // this element never resolves → salvage
        return `currentTask.resolve({ n: item });`;
      }
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
    });
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(result.degraded).toBe(true);
    expect(result.degradedTasks).toEqual(['each[2]']);
    expect(result.ok).toBe(false); // the goal task itself had a salvaged element
    expect(result.reason).toBe('no_resolve');
    // Element outputs stay RAW schema data — the salvaged element is a neutral empty.
    expect(result.data).toEqual([{ n: 10 }, { n: 20 }, { n: 0 }]);
  });

  it('retries a FAILING forEach element (fresh fork) and keeps its later successful result', async () => {
    // A required forEach element whose fork REJECTS (off-schema resolve) is retried with a fresh
    // fork; the model gets another try. Here item 20 fails twice then resolves valid on attempt 3 —
    // so the element is NOT salvaged and the tasklist is not degraded.
    const dir = await makeTasklistSpace({
      '01-list.md': `---\nid: list\noutput:\n  items: array\n---\n\nLIST_T: produce the list.`,
      '02-each.md': `---\nid: each\ndependsOn: [list]\nforEach: list.items\ngoal: true\noutput:\n  n: number\n---\n\nEACH_T: process one item.`,
    });
    const space = await loadSpace(dir);
    let item20Attempts = 0;
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('LIST_T')) return `currentTask.resolve({ items: [10, 20] });`;
      if (user.includes('EACH_T')) {
        if (user.includes('- item: 20')) {
          item20Attempts++;
          return item20Attempts < 3 ? `currentTask.resolve({ n: "bad" });` : `currentTask.resolve({ n: item });`;
        }
        return `currentTask.resolve({ n: item });`;
      }
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
    });
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(item20Attempts).toBe(3); // two failed attempts + one that succeeded
    expect(result.ok).toBe(true); // element eventually resolved valid → not salvaged
    expect(result.degraded).toBe(false);
    expect(result.data).toEqual([{ n: 10 }, { n: 20 }]);
  });

  it('salvages a forEach element ONLY after exhausting its retries (one bad item never sinks the task)', async () => {
    // item 20 fails every attempt → retried 3× then salvaged, so the required task still completes.
    const dir = await makeTasklistSpace({
      '01-list.md': `---\nid: list\noutput:\n  items: array\n---\n\nLIST_T: produce the list.`,
      '02-each.md': `---\nid: each\ndependsOn: [list]\nforEach: list.items\ngoal: true\noutput:\n  n: number\n---\n\nEACH_T: process one item.`,
    });
    const space = await loadSpace(dir);
    let item20Attempts = 0;
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('LIST_T')) return `currentTask.resolve({ items: [10, 20] });`;
      if (user.includes('EACH_T')) {
        if (user.includes('- item: 20')) { item20Attempts++; return `currentTask.resolve({ n: "bad" });`; }
        return `currentTask.resolve({ n: item });`;
      }
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
    });
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(item20Attempts).toBe(3); // exactly the retry budget, then salvage
    expect(result.degradedTasks).toEqual(['each[1]']);
    expect(result.data).toEqual([{ n: 10 }, { n: 0 }]); // item 20 salvaged to the neutral default
  });

  it('a degraded NON-goal task marks the envelope degraded but keeps ok:true', async () => {
    const dir = await makeTasklistSpace({
      '01-shaky.md': `---\nid: shaky\noutput:\n  hint: string\n---\n\nSHAKY_T: never resolves.`,
      '02-main.md': `---\nid: main\ndependsOn: [shaky]\ngoal: true\noutput:\n  v: number\n---\n\nMAIN_T: the goal.`,
    });
    const space = await loadSpace(dir);
    const engine = engineFor(dir, [{ token: 'MAIN_T', code: `currentTask.resolve({ v: 3 });` }], []);
    const result = await runTasklist({ name: 'flow', space, forkEngine: engine });
    expect(result.ok).toBe(true); // the GOAL resolved un-salvaged
    expect(result.degraded).toBe(true); // …but the pipeline carried a salvage
    expect(result.degradedTasks).toEqual(['shaky']);
    expect(result.reason).toBeUndefined(); // reason describes the goal only
    expect(result.data).toEqual({ v: 3 });
  });

  it('hard-filters the seed to the DECLARED input keys before forking', async () => {
    // Root cause A2: the whole seed used to spread into every fork, so delegator baggage
    // (e.g. parentHistory) rode into leaf prompts under nesting. With a declared input
    // schema, forks receive ONLY the declared keys.
    const dir = await mkdtemp(join(tmpdir(), 'lmthing-orch-'));
    tmpDirs.push(dir);
    await mkdir(join(dir, 'agents', 'main'), { recursive: true });
    await writeFile(join(dir, 'agents', 'main', 'instruct.md'), 'You are a runner.\n', 'utf8');
    const tl = join(dir, 'tasklists', 'flow');
    await mkdir(tl, { recursive: true });
    await writeFile(join(tl, 'index.md'), `---\ninput:\n  query: string\n---\n\nEcho the query.`, 'utf8');
    await writeFile(join(tl, '01-main.md'), `---\nid: main\ngoal: true\noutput:\n  echo: string\n---\n\nECHO_T: echo the query seed var.`, 'utf8');
    const space = await loadSpace(dir);
    let forkPrompt = '';
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('ECHO_T')) {
        forkPrompt = user;
        return `currentTask.resolve({ echo: query });`;
      }
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
    });
    const result = await runTasklist({
      name: 'flow', space, forkEngine: engine,
      seed: { query: 'x', junk: 'y', parentHistory: 'z' },
    });
    // The declared key made it through — as a real seed VAR (the fork read it) and in the prompt.
    expect(result.data).toEqual({ echo: 'x' });
    expect(forkPrompt).toContain('query');
    // The undeclared baggage did NOT reach the fork's prompt/seed.
    expect(forkPrompt).not.toContain('junk');
    expect(forkPrompt).not.toContain('parentHistory');
  });

  it('passes the full seed through when the tasklist declares NO input schema (back-compat)', async () => {
    const dir = await makeTasklistSpace({
      '01-main.md': `---\nid: main\ngoal: true\noutput:\n  echo: string\n---\n\nPASS_T: echo the junk seed var.`,
    });
    const space = await loadSpace(dir);
    let forkPrompt = '';
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      if (user.includes('PASS_T')) {
        forkPrompt = user;
        return `currentTask.resolve({ echo: junk });`;
      }
      return '';
    });
    const engine = new ForkEngine({
      maxConcurrentForks: 4, parentHistory: [], parentSpaceDir: dir, parentAgentSlug: 'main',
      renderHost: silentHost, streamFn,
    });
    const result = await runTasklist({
      name: 'flow', space, forkEngine: engine,
      seed: { query: 'x', junk: 'y' },
    });
    expect(result.data).toEqual({ echo: 'y' }); // undeclared-input tasklist: everything flows
    expect(forkPrompt).toContain('junk');
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
    expect(result.data).toEqual({ v: 2 });
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
    expect(result.data).toEqual({ v: 5 });
  });
});

/**
 * Step-9 L2 execution proof: the REAL user-thing `resolve_flagged_figure` tasklist scheduled by the
 * real runTasklist. Its terminal `report` is an UNCONDITIONAL goal that MERGES both branches, precisely
 * because a condition-gated goal that gets skipped throws "produced no result" (Clarification 2). These
 * two runs prove the merge holds from both sides — the low-confidence path (fix condition-skipped) must
 * NOT throw and must relay the diagnosis's question, and the high-confidence path applies + reports.
 */
describe('user-thing resolve_flagged_figure — confidence-gated diagnose → fix → merge-report', () => {
  const userThingDir = join(__dirname, '..', '..', 'system-spaces', 'user-thing');
  // report branches on diagnose.confidence and writes only the ONE matching resolve — the low path
  // never references the skipped `fix` (it is absent from that fork's inputs AND its ambient DTS).
  const REPORT_LOW = `currentTask.resolve({ ok: false, applied: false, question: diagnose.question, detail: diagnose.detail });`;
  const REPORT_HIGH = `currentTask.resolve({ ok: fix.applied, applied: fix.applied, question: '', detail: fix.detail });`;

  function rffEngine(answers: Array<{ token: string; code: string }>, seen: string[]): ForkEngine {
    const streamFn = createMockStreamFn((o: StreamOpts) => {
      const user = o.messages.map((m) => m.content).join('\n');
      for (const a of answers) {
        if (user.includes('Output schema:') && user.includes(a.token)) {
          seen.push(a.token);
          return a.code;
        }
      }
      return '';
    });
    return new ForkEngine({
      maxConcurrentForks: 4,
      parentHistory: [],
      parentSpaceDir: userThingDir,
      parentAgentSlug: 'thing',
      renderHost: silentHost,
      streamFn,
    });
  }

  it('low confidence: fix is SKIPPED, and the unconditional goal relays the question (never throws)', async () => {
    const space = await loadSpace(userThingDir, { requireAgents: false });
    const seen: string[] = [];
    const engine = rffEngine(
      [
        {
          token: 'Investigate the flagged figure',
          code: `currentTask.resolve({ cause: "more than one row could be the culprit", table: "", targetIds: [], fixAction: "none", targetValue: "", confidence: "low", question: "Which of the two entries is the wrong one?", detail: "genuinely ambiguous" });`,
        },
        { token: 'Report the outcome to the caller', code: REPORT_LOW },
      ],
      seen,
    );
    // Must NOT throw: report is the unconditional goal, so a skipped fix never trips the skipped-goal throw.
    const goal = await runTasklist({
      name: 'resolve_flagged_figure', space, forkEngine: engine, seed: { complaint: 'that total looks too high' },
    });
    expect(seen).toContain('Investigate the flagged figure');
    expect(seen).toContain('Report the outcome to the caller');
    expect(seen).not.toContain('Carry out exactly the correction'); // fix fork was never dispatched
    expect(goal.data).toMatchObject({ ok: false, applied: false });
    expect((goal.data as { question: string }).question).toBe('Which of the two entries is the wrong one?');
  });

  it('high confidence: fix runs and the goal reports the applied correction', async () => {
    const space = await loadSpace(userThingDir, { requireAgents: false });
    const seen: string[] = [];
    const engine = rffEngine(
      [
        {
          token: 'Investigate the flagged figure',
          code: `currentTask.resolve({ cause: "a duplicated line item", table: "cost_items", targetIds: ["row-1"], fixAction: "remove", targetValue: "", confidence: "high", question: "", detail: "one clear duplicate" });`,
        },
        {
          token: 'Carry out exactly the correction',
          code: `currentTask.resolve({ applied: true, changed: 1, before: "the old figure", after: "the corrected figure", detail: "removed the duplicated row" });`,
        },
        { token: 'Report the outcome to the caller', code: REPORT_HIGH },
      ],
      seen,
    );
    const goal = await runTasklist({
      name: 'resolve_flagged_figure', space, forkEngine: engine, seed: { complaint: 'the maths does not add up' },
    });
    expect(seen).toContain('Carry out exactly the correction'); // fix DID run on high confidence
    expect(goal.data).toMatchObject({ ok: true, applied: true });
  });
});

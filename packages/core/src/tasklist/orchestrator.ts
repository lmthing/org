import type { Space } from '../spaces/load.js';
import type { ForkEngine } from '../fork/fork.js';
import { loadTasklist } from '../spaces/tasklist-load.js';
import { validateDag, findReadyTasks, resolveGoalTask } from './dag.js';
import type { TaskNode } from '../spaces/tasklist-load.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { validateInput } from './schema.js';

export async function runTasklist(opts: {
  name: string;
  space: Space;
  forkEngine: ForkEngine;
  seed?: Record<string, unknown>;
  tracer?: Tracer;
  parentScope?: TraceScope;
}): Promise<unknown> {
  const { name, space, forkEngine, seed, tracer, parentScope } = opts;

  const tasklistDir = space.tasklists[name];
  if (!tasklistDir) {
    throw new Error(`Tasklist "${name}" not found in space`);
  }

  // Validate the runtime seed against the tasklist's declared input schema
  // (tasklists/<name>/index.md frontmatter). No declared schema → accept any seed.
  if (tasklistDir.input && Object.keys(tasklistDir.input).length > 0) {
    const errors = validateInput(tasklistDir.input, seed ?? {});
    if (errors.length > 0) {
      throw new Error(
        `Tasklist "${name}" received an invalid seed:\n  - ${errors.join('\n  - ')}`,
      );
    }
  }

  const tasks = await loadTasklist(tasklistDir.slug, tasklistDir.files);
  validateDag(tasks);
  const goalTask = resolveGoalTask(tasks);

  // Mint a tasklist node so the tree shows this orchestration scope
  const tasklistScope = tracer && parentScope
    ? tracer.child(parentScope, 'tasklist', `tasklist:${name}`, { tasklist: name })
    : undefined;

  const done = new Set<string>();
  const skipped = new Set<string>();
  const allOutputs: Record<string, unknown> = {};
  let goalOutput: unknown;

  // Build up upstream outputs per task
  function getUpstreamOutputs(task: TaskNode): Record<string, unknown> {
    const upstream: Record<string, unknown> = {};
    for (const dep of task.dependsOn ?? []) {
      if (allOutputs[dep] !== undefined) {
        upstream[dep] = allOutputs[dep];
      }
    }
    return upstream;
  }

  // Emit a `task` node and immediately end it as skipped (condition not met /
  // optional fork failed). Tracks via `skippedEmitted` so we never double-emit.
  const skippedEmitted = new Set<string>();
  const emitSkip = (task: TaskNode): void => {
    if (!tracer || !tasklistScope || skippedEmitted.has(task.id)) return;
    skippedEmitted.add(task.id);
    const s = tracer.child(tasklistScope, 'task', `fork:${task.id}`, {
      tasklist: name, dependsOn: task.dependsOn, optional: task.optional, condition: task.condition, goal: task.goal,
    });
    tracer.end(s, 'skipped');
  };

  try {
    // Run until all tasks are done/skipped
    while (done.size + skipped.size < Object.keys(tasks).length) {
      const ready = findReadyTasks(tasks, done, skipped, allOutputs);

      if (ready.length === 0) {
        // Check if there are tasks remaining but none are ready (stuck)
        const remaining = Object.keys(tasks).filter((id) => !done.has(id) && !skipped.has(id));
        if (remaining.length > 0) {
          // Skip tasks whose conditions aren't met
          for (const id of remaining) {
            const task = tasks[id]!;
            const deps = task.dependsOn ?? [];
            const depsOk = deps.every((dep) => done.has(dep) || skipped.has(dep));
            if (depsOk && (task.optional || task.condition)) {
              // Condition not met (or optional with unmet deps) — skip + trace it.
              skipped.add(id);
              emitSkip(task);
            }
          }

          // Check if we're truly stuck
          const stillRemaining = Object.keys(tasks).filter(
            (id) => !done.has(id) && !skipped.has(id),
          );
          if (stillRemaining.length === remaining.length) {
            throw new Error(`Tasklist "${name}" is stuck: tasks ${stillRemaining.join(', ')} cannot be resolved`);
          }
        }
        continue;
      }

      // Mint each ready task's scope up front so we can end it on success OR failure.
      const taskScopes = new Map<string, TraceScope | undefined>();

      // Run all ready tasks in parallel (within fork concurrency cap)
      const results = await Promise.allSettled(
        ready.map(async (task) => {
          const upstreamOutputs = getUpstreamOutputs(task);
          const taskScope = tracer && tasklistScope
            ? tracer.child(tasklistScope, 'task', `fork:${task.id}`, {
                tasklist: name, dependsOn: task.dependsOn, optional: task.optional, condition: task.condition, goal: task.goal,
              })
            : undefined;
          taskScopes.set(task.id, taskScope);
          const output = await forkEngine.fork({
            instruction: task.instruction,
            output: task.output,
            seed: seed,
            upstreamOutputs: Object.keys(upstreamOutputs).length > 0 ? upstreamOutputs : undefined,
            taskId: task.id,
            parentScope: taskScope,
          });
          return { task, output };
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { task, output } = result.value;
          done.add(task.id);
          allOutputs[task.id] = output;
          if (tracer) { const ts = taskScopes.get(task.id); if (ts) tracer.end(ts, 'done', { result: output }); }
          if (goalTask && task.id === goalTask.id) goalOutput = output;
        } else {
          // Fork failed
          const failedTask = ready[results.indexOf(result)]!;
          const ts = taskScopes.get(failedTask.id);
          if (failedTask.optional) {
            skipped.add(failedTask.id);
            skippedEmitted.add(failedTask.id);
            if (tracer && ts) tracer.end(ts, 'skipped');
          } else {
            const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
            if (tracer && ts) tracer.end(ts, 'error', { error: errMsg });
            throw new Error(`Required task "${failedTask.id}" failed: ${errMsg}`);
          }
        }
      }
    }

    if (tracer && tasklistScope) tracer.end(tasklistScope, 'done', { result: goalOutput });
    return goalOutput;
  } catch (err) {
    if (tracer && tasklistScope) tracer.end(tasklistScope, 'error', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

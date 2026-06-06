import type { Space } from '../spaces/load.js';
import type { ForkEngine } from '../fork/fork.js';
import { loadTasklist } from '../spaces/tasklist-load.js';
import { validateDag, findReadyTasks } from './dag.js';
import type { TaskNode } from '../spaces/tasklist-load.js';

export async function runTasklist(opts: {
  name: string;
  space: Space;
  forkEngine: ForkEngine;
  seed?: Record<string, unknown>;
}): Promise<unknown> {
  const { name, space, forkEngine, seed } = opts;

  const tasklistDir = space.tasklists[name];
  if (!tasklistDir) {
    throw new Error(`Tasklist "${name}" not found in space`);
  }

  const tasks = await loadTasklist(tasklistDir.slug, tasklistDir.files);
  validateDag(tasks);

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
          if (depsOk) {
            // Condition not met — skip optional tasks
            if (task.optional) {
              skipped.add(id);
            } else if (task.condition) {
              // Condition failed — skip
              skipped.add(id);
            }
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

    // Run all ready tasks in parallel (within fork concurrency cap)
    const results = await Promise.allSettled(
      ready.map(async (task) => {
        const upstreamOutputs = getUpstreamOutputs(task);
        const output = await forkEngine.fork({
          instruction: task.instruction,
          output: task.output,
          seed: seed,
          upstreamOutputs: Object.keys(upstreamOutputs).length > 0 ? upstreamOutputs : undefined,
          taskId: task.id,
        });
        return { task, output };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { task, output } = result.value;
        done.add(task.id);
        allOutputs[task.id] = output;

        if (task.goal) {
          goalOutput = output;
        }
      } else {
        // Fork failed
        const failedTask = ready[results.indexOf(result)]!;
        if (failedTask.optional) {
          skipped.add(failedTask.id);
        } else {
          throw new Error(
            `Required task "${failedTask.id}" failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
        }
      }
    }
  }

  return goalOutput;
}

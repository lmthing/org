import type { Space } from '../spaces/load.js';
import type { ForkEngine } from '../fork/fork.js';
import { loadTasklist } from '../spaces/tasklist-load.js';
import { validateDag, findReadyTasks, resolveGoalTask } from './dag.js';
import type { TaskNode } from '../spaces/tasklist-load.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { validateInput } from './schema.js';

/** Resolve a `forEach` reference ("taskId" or "taskId.field.subfield") against accumulated
 *  task outputs. Returns the referenced array, or [] when missing / not an array. */
function resolveForEachItems(ref: string, allOutputs: Record<string, unknown>): unknown[] {
  const parts = ref.split('.');
  let val: unknown = allOutputs[parts[0]!];
  for (const part of parts.slice(1)) {
    if (val && typeof val === 'object') val = (val as Record<string, unknown>)[part];
    else { val = undefined; break; }
  }
  return Array.isArray(val) ? val : [];
}

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
                tasklist: name, dependsOn: task.dependsOn, optional: task.optional, condition: task.condition, goal: task.goal, forEach: task.forEach,
              })
            : undefined;
          taskScopes.set(task.id, taskScope);

          const upstream = Object.keys(upstreamOutputs).length > 0 ? upstreamOutputs : undefined;
          const runFork = (extraSeed?: Record<string, unknown>, elemScope?: TraceScope): Promise<unknown> =>
            forkEngine.fork({
              instruction: task.instruction,
              output: task.output,
              seed: extraSeed ? { ...(seed ?? {}), ...extraSeed } : seed,
              upstreamOutputs: upstream,
              taskId: task.id,
              role: task.role,
              functions: task.functions,
              canDelegateTo: task.canDelegateTo,
              tasklistDescription: tasklistDir.description,
              parentScope: elemScope ?? taskScope,
            });

          // forEach: host-driven fan-out. Resolve the referenced upstream array and run the
          // task once per element (parallel, within the engine's concurrency cap), injecting
          // the element as `item` (+ `index`). Collect the resolved values into an array.
          if (task.forEach) {
            const items = resolveForEachItems(task.forEach, allOutputs);
            const output = await Promise.all(
              items.map((item, index) => {
                const elemScope = tracer && taskScope
                  ? tracer.child(taskScope, 'task', `fork:${task.id}[${index}]`, { tasklist: name, forEachIndex: index })
                  : undefined;
                return runFork({ item, index }, elemScope).then((value) => {
                  if (tracer && elemScope) tracer.end(elemScope, 'done', { result: value });
                  return value;
                });
              }),
            );
            return { task, output };
          }

          const output = await runFork();
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

    // A skipped goal task means the pipeline short-circuited — an upstream
    // condition was not met — and produced NO result. Returning `undefined`
    // here would surface to the caller as a silent `null` delegate result with
    // no explanation (the exact failure that left the architect returning null).
    // Fail loudly instead, folding in any upstream `errors`/`error` fields so the
    // model sees WHY (e.g. a validation failure) and can react.
    if (goalTask && skipped.has(goalTask.id)) {
      const diagnostics = Object.entries(allOutputs)
        .map(([id, out]) => {
          if (out && typeof out === 'object') {
            const err = (out as Record<string, unknown>).errors ?? (out as Record<string, unknown>).error;
            if (typeof err === 'string' && err.trim()) return `${id}: ${err.trim()}`;
          }
          return null;
        })
        .filter((d): d is string => d !== null);
      const detail = diagnostics.length > 0 ? ` Upstream errors — ${diagnostics.join('; ')}` : '';
      throw new Error(
        `Tasklist "${name}" produced no result: its goal task "${goalTask.id}" was skipped ` +
          `because an upstream condition was not met.${detail}`,
      );
    }

    if (tracer && tasklistScope) tracer.end(tasklistScope, 'done', { result: goalOutput });
    return goalOutput;
  } catch (err) {
    if (tracer && tasklistScope) tracer.end(tasklistScope, 'error', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

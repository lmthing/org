import type { TaskNode } from '../spaces/tasklist-load.js';
import { evaluateCondition } from './condition-dsl.js';

export function validateDag(tasks: Record<string, TaskNode>): void {
  const ids = Object.keys(tasks);

  // At most one explicit goal. 0 is valid — the effective goal then falls
  // back to the last task in file order (see resolveGoalTask below).
  const goalTasks = ids.filter((id) => tasks[id]!.goal);
  if (goalTasks.length > 1) {
    throw new Error(`Tasklist has multiple goal tasks: ${goalTasks.join(', ')}`);
  }

  // Check all dependsOn references are valid
  for (const id of ids) {
    const task = tasks[id]!;
    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        if (!(dep in tasks)) {
          throw new Error(`Task "${id}" depends on unknown task "${dep}"`);
        }
      }
    }
    // forEach must name an upstream task (the head segment) that this task depends on, so
    // its output array is available by the time the host fans this task out.
    if (task.forEach) {
      const head = task.forEach.split('.')[0]!;
      if (!(head in tasks)) {
        throw new Error(`Task "${id}" forEach references unknown task "${head}"`);
      }
      if (!(task.dependsOn ?? []).includes(head)) {
        throw new Error(`Task "${id}" forEach "${task.forEach}" must also be listed in dependsOn (add "${head}")`);
      }
    }
  }

  // onFail.goto must name a task this one transitively depends on: resuming works by
  // un-doing the nodes BETWEEN goto and here, so a goto that is not upstream would either
  // reset nothing or reset an unrelated branch.
  for (const id of ids) {
    const onFail = tasks[id]!.onFail;
    if (!onFail) continue;
    if (!(onFail.goto in tasks)) {
      throw new Error(`Task "${id}" onFail.goto references unknown task "${onFail.goto}"`);
    }
    if (onFail.goto === id) {
      throw new Error(
        `Task "${id}" onFail.goto points at itself — a node cannot resume from itself (name the upstream step to redo)`,
      );
    }
    if (!ancestorsOf(tasks, id).has(onFail.goto)) {
      throw new Error(
        `Task "${id}" onFail.goto "${onFail.goto}" must be a task "${id}" transitively depends on`,
      );
    }
  }

  // Check no cycles using DFS
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  for (const id of ids) color[id] = WHITE;

  function dfs(id: string): void {
    color[id] = GRAY;
    const task = tasks[id]!;
    for (const dep of task.dependsOn ?? []) {
      if (color[dep] === GRAY) {
        throw new Error(`Cycle detected in tasklist: "${id}" -> "${dep}"`);
      }
      if (color[dep] === WHITE) {
        dfs(dep);
      }
    }
    color[id] = BLACK;
  }

  for (const id of ids) {
    if (color[id] === WHITE) dfs(id);
  }
}

/** Every task reachable by following `dependsOn` upward from `id` (excluding `id`). */
export function ancestorsOf(tasks: Record<string, TaskNode>, id: string): Set<string> {
  const seen = new Set<string>();
  const walk = (cur: string): void => {
    for (const dep of tasks[cur]?.dependsOn ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      walk(dep);
    }
  };
  walk(id);
  return seen;
}

/**
 * The nodes an `onFail` resume must un-do: `goto` and `node` themselves, plus every task
 * BETWEEN them — i.e. each task that both descends from `goto` and is an ancestor of
 * `node`. Nodes on unrelated branches are deliberately left `done`, so resuming redoes the
 * failed stretch and nothing else.
 */
export function resumeSet(tasks: Record<string, TaskNode>, from: string, to: string): Set<string> {
  const body = new Set<string>([from, to]);
  const toAncestors = ancestorsOf(tasks, to);
  for (const id of Object.keys(tasks)) {
    if (id === from || id === to) continue;
    // between = ancestor of `to` AND descendant of `from`
    if (toAncestors.has(id) && ancestorsOf(tasks, id).has(from)) body.add(id);
  }
  return body;
}

/**
 * Resolve the tasklist's effective goal task: the explicit `goal: true` task
 * when present, else the last task in file order (tasks are inserted into
 * `tasks` in file/NN-prefix order by `loadTasklist`, which JS object
 * insertion order preserves for string keys).
 */
export function resolveGoalTask(tasks: Record<string, TaskNode>): TaskNode | undefined {
  const values = Object.values(tasks);
  const explicit = values.find((t) => t.goal);
  if (explicit) return explicit;
  return values[values.length - 1];
}

export function topoSort(tasks: Record<string, TaskNode>): TaskNode[] {
  const ids = Object.keys(tasks);
  const visited = new Set<string>();
  const result: TaskNode[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const task = tasks[id]!;
    for (const dep of task.dependsOn ?? []) {
      visit(dep);
    }
    result.push(task);
  }

  for (const id of ids) visit(id);
  return result;
}

export function findReadyTasks(
  tasks: Record<string, TaskNode>,
  done: Set<string>,
  skipped: Set<string>,
  outputs: Record<string, unknown>,
): TaskNode[] {
  const ready: TaskNode[] = [];

  for (const [id, task] of Object.entries(tasks)) {
    // Skip already done/skipped tasks
    if (done.has(id) || skipped.has(id)) continue;

    // Check all dependencies are satisfied
    const deps = task.dependsOn ?? [];
    const depsOk = deps.every((dep) => done.has(dep) || skipped.has(dep));
    if (!depsOk) continue;

    // Check condition if present
    if (task.condition) {
      try {
        const condOk = evaluateCondition(task.condition, outputs);
        if (!condOk) {
          // Condition not met — skip this task
          continue;
        }
      } catch {
        continue;
      }
    }

    ready.push(task);
  }

  return ready;
}

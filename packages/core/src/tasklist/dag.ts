import type { TaskNode } from '../spaces/tasklist-load.js';
import { evaluateCondition } from './condition-dsl.js';

export function validateDag(tasks: Record<string, TaskNode>): void {
  const ids = Object.keys(tasks);

  // Check exactly one goal
  const goalTasks = ids.filter((id) => tasks[id]!.goal);
  if (goalTasks.length === 0) {
    throw new Error('Tasklist must have exactly one task with goal: true');
  }
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

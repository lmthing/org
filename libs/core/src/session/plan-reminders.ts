/**
 * Pure decision logic for the plan (open-todos) soft reminder the Session wires
 * into `beforeTurn` (see `ReminderRegistry` / `session.ts`). Kept here, free of
 * any filesystem access, so the behaviour is unit-testable without booting a
 * whole Session — the caller reads `.lmthing/todos.json` and hands the raw text
 * (or `undefined` when there is no file) to this function.
 *
 * The plan itself is the model-maintained checklist written by the `todoWrite`
 * system function: an array of `{ content, status }` where status is
 * `pending | in_progress | completed | failed`.
 */

interface PlanItem {
  content: string;
  status?: unknown;
}

/** Parse the persisted plan, tolerating a missing file, bad JSON, or junk shape. */
function parsePlan(rawTodos: string | undefined): PlanItem[] {
  if (typeof rawTodos !== 'string') return [];
  try {
    const items = JSON.parse(rawTodos) as unknown;
    if (!Array.isArray(items)) return [];
    return items.filter(
      (i): i is PlanItem => !!i && typeof (i as PlanItem).content === 'string',
    );
  } catch {
    return [];
  }
}

/** `~` in-progress, `✗` failed, ` ` otherwise — the checkbox mark in the reminder. */
function mark(status: unknown): string {
  return status === 'in_progress' ? '~' : status === 'failed' ? '✗' : ' ';
}

/**
 * Open-plan reminder: re-surface every task that has not `completed` so the agent
 * never loses the thread and keeps the plan's statuses current. `failed` is
 * terminal but still surfaced so the agent acknowledges the failure (retry, work
 * around it, or drop it) rather than silently ignoring it. Returns `undefined`
 * when there is no plan or everything is done.
 */
export function openPlanReminder(rawTodos: string | undefined): string | undefined {
  const open = parsePlan(rawTodos).filter((i) => i.status !== 'completed');
  if (open.length === 0) return undefined;
  return [
    '## Your plan (keep it live)',
    'Work through this plan. Mark a task `in_progress` before you start it and `completed` or `failed` ' +
      'the moment it resolves — call `todoWrite` with the full updated list to add, remove, reorder, or ' +
      'restatus tasks as the work changes. `✗` marks a failed task you still need to address.',
    ...open.map((i) => `- [${mark(i.status)}] ${i.content}`),
  ].join('\n');
}

/**
 * Set the plan (replaces the whole list): render a live checklist + persist it. Outline the
 * steps before multi-step work; re-call with the full updated list to add/remove/reorder/restatus
 * tasks. Mark each `in_progress` when you start it, then `completed` or `failed` when it resolves.
 */
export function todoWrite(
  items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }>,
): { ok: boolean; count: number } {
  const ALLOWED = ['pending', 'in_progress', 'completed', 'failed'];
  const valid = (items ?? [])
    .filter((i) => i && typeof i.content === 'string')
    .map((i) => ({
      content: i.content,
      status: (ALLOWED.includes(i.status as string) ? i.status : 'pending') as
        | 'pending'
        | 'in_progress'
        | 'completed'
        | 'failed',
    }));
  const path = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/todos.json';
  writeFileRaw(path, JSON.stringify(valid, null, 2));
  // A host-emitted `checklist` descriptor (see libs/core/src/ui/descriptor.ts RENDER_ALIASES):
  // renders with real checkboxes + per-task status in /chat on personal and team pods alike.
  display({ type: 'checklist', props: { title: 'Plan', items: valid } });
  return { ok: true, count: valid.length };
}

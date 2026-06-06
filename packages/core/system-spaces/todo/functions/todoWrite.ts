/** Set the current task checklist (replaces the whole list), render it, and persist it. */
export function todoWrite(
  items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>,
): { ok: boolean; count: number } {
  const valid = (items ?? []).filter((i) => i && typeof i.content === 'string');
  const path = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/todos.json';
  writeFileRaw(path, JSON.stringify(valid, null, 2));
  const mark = (s: string): string => (s === 'completed' ? '[x]' : s === 'in_progress' ? '[~]' : '[ ]');
  const text = '## Todos\n' + valid.map((i) => `${mark(i.status)} ${i.content}`).join('\n');
  display(text);
  return { ok: true, count: valid.length };
}

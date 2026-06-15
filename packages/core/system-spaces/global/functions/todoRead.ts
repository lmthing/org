/** Read the current task checklist. */
export function todoRead(): {
  ok: boolean;
  items: Array<{ content: string; status: string }>;
} {
  const path = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/todos.json';
  const r = readFileRaw(path);
  if (!r.ok) return { ok: true, items: [] };
  try {
    return { ok: true, items: JSON.parse(r.content) as Array<{ content: string; status: string }> };
  } catch {
    return { ok: true, items: [] };
  }
}

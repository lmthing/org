/** Return all remembered facts as a key to value object. */
export function recallAll(): { ok: boolean; facts: Record<string, unknown> } {
  const path = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/memory.json';
  const r = readFileRaw(path);
  if (!r.ok) return { ok: true, facts: {} };
  try {
    return { ok: true, facts: JSON.parse(r.content) as Record<string, unknown> };
  } catch {
    return { ok: true, facts: {} };
  }
}

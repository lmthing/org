/** Recall a previously remembered fact by key. found=false if it was never stored. */
export function recall(key: string): { ok: boolean; value: unknown; found: boolean } {
  const path = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/memory.json';
  const r = readFileRaw(path);
  if (!r.ok) return { ok: true, value: undefined, found: false };
  try {
    const store = JSON.parse(r.content) as Record<string, unknown>;
    return { ok: true, value: store[key], found: key in store };
  } catch {
    return { ok: true, value: undefined, found: false };
  }
}

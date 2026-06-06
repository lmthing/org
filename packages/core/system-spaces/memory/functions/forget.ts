/** Delete a remembered fact by key. */
export function forget(key: string): { ok: boolean; error?: string } {
  const path = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/memory.json';
  const r = readFileRaw(path);
  let store: Record<string, unknown> = {};
  if (r.ok) {
    try {
      store = JSON.parse(r.content);
    } catch {
      store = {};
    }
  }
  delete store[key];
  const w = writeFileRaw(path, JSON.stringify(store, null, 2));
  return w.ok ? { ok: true } : { ok: false, error: w.error };
}

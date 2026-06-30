/** Persist a fact across sessions under a key (durable, space-scoped). */
export function remember(key: string, value: unknown): { ok: boolean; error?: string } {
  const path = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/memory.json';
  let store: Record<string, unknown> = {};
  const r = readFileRaw(path);
  if (r.ok) {
    try {
      store = JSON.parse(r.content);
    } catch {
      store = {};
    }
  }
  store[key] = value;
  const w = writeFileRaw(path, JSON.stringify(store, null, 2));
  return w.ok ? { ok: true } : { ok: false, error: w.error };
}

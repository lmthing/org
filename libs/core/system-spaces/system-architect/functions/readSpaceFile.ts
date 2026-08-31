/**
 * Read a file under a space directory as text — the read twin of the space writers,
 * SPACE-ROOTED (resolves against `resolveSpaceDir(space)`, never the agent's own dir).
 * Used by the iterate flow to inspect an existing agent/function/knowledge file before
 * editing it. `relPath` is a path relative to the space root (e.g.
 * 'agents/researcher/instruct.md'). No imports.
 *
 * `content` is the PLAIN, unmodified file text — there is NO `raw` field and NO line-numbered
 * variant (a `.raw` access is a typecheck error; `.raw` exists only on the engineer's scratch
 * `readFile`, whose `content` is line-numbered for display — not here).
 *
 * @returns { ok, content, error? }
 */
export function readSpaceFile(
  space: string,
  relPath: string,
): { ok: boolean; content: string; error?: string } {
  const dir = resolveSpaceDir(space);
  if (!relPath || typeof relPath !== 'string') {
    return { ok: false, content: '', error: 'readSpaceFile: relPath is required' };
  }
  const path = spacePath(dir, relPath);
  const r = readFileRaw(path);
  if (!r.ok) return { ok: false, content: '', error: r.error };
  return { ok: true, content: r.content };
}

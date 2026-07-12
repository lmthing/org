/**
 * Read a file under a space directory as text — the read twin of the space writers,
 * SPACE-ROOTED (resolves against `resolveSpaceDir(space)`, never the agent's own dir).
 * Used by the iterate flow to inspect an existing agent/function/knowledge file before
 * editing it. `relPath` is a path relative to the space root (e.g.
 * 'agents/researcher/instruct.md'). No imports.
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

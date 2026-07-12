/**
 * List the entries of a sub-directory of a space — the read twin of the space writers,
 * SPACE-ROOTED (resolves against `resolveSpaceDir(space)`, never the agent's own dir).
 * Used by the iterate flow to discover what a space already contains. `subdir` is a path
 * relative to the space root (e.g. 'agents', 'functions', 'knowledge/journalism'); omit
 * it to list the space root. A missing dir returns `entries: []` (not an error). No imports.
 *
 * @returns { ok, entries, error? }
 */
export function listSpaceDir(
  space: string,
  subdir?: string,
): { ok: boolean; entries: string[]; error?: string } {
  const dir = resolveSpaceDir(space);
  const target = subdir ? spacePath(dir, subdir) : dir;
  const r = execShell(`ls -1A "${target}" 2>/dev/null`);
  if (!r.ok) return { ok: true, entries: [] };
  return {
    ok: true,
    entries: r.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

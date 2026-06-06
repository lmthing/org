/** Join path segments with '/'. Replaces node:path.join inside the QuickJS VM. */
function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

/**
 * List all sub-directories of baseDir that look like spaces (contain an
 * agents/ subdirectory). Uses execShell ls only — no Node imports.
 *
 * @param baseDir Absolute path to the directory containing space directories.
 * @returns       Array of { name, dir, agents } for each found space.
 */
export function listScaffoldedSpaces(
  baseDir: string,
): { name: string; dir: string; agents: string[] }[] {
  const lsResult = execShell(`ls -1 "${baseDir}" 2>/dev/null`);
  if (!lsResult.ok || !lsResult.stdout.trim()) return [];

  const names = lsResult.stdout.trim().split('\n').filter(Boolean);
  const results: { name: string; dir: string; agents: string[] }[] = [];

  for (const name of names) {
    const dir = joinPath(baseDir, name);
    const agentsCheck = execShell(`ls -1 "${joinPath(dir, 'agents')}" 2>/dev/null`);
    if (agentsCheck.ok && agentsCheck.stdout.trim()) {
      const agents = agentsCheck.stdout.trim().split('\n').filter(Boolean);
      results.push({ name, dir, agents });
    }
  }

  return results;
}

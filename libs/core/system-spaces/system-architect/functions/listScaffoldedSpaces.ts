/**
 * List all sub-directories of the project spaces dir that look like spaces (contain
 * an agents/ subdirectory). Uses execShell ls only — no Node imports.
 *
 * @param baseDir Optional override. Defaults to the host-injected project spaces dir
 *                (process.env.LMTHING_PROJECT_SPACES_DIR = .lmthing/<project>/spaces,
 *                default .lmthing/user/spaces) — the model calls this with no args.
 * @returns       Array of { name, dir, agents } for each found space.
 */
export function listScaffoldedSpaces(
  baseDir?: string,
): { name: string; dir: string; agents: string[] }[] {
  const root = (baseDir || process.env.LMTHING_PROJECT_SPACES_DIR || '.lmthing/user/spaces').replace(/\/+$/, '');
  const lsResult = execShell(`ls -1 "${root}" 2>/dev/null`);
  if (!lsResult.ok || !lsResult.stdout.trim()) return [];

  const names = lsResult.stdout.trim().split('\n').filter(Boolean);
  const results: { name: string; dir: string; agents: string[] }[] = [];

  for (const name of names) {
    const dir = spacePath(root, name);
    const agentsCheck = execShell(`ls -1 "${spacePath(dir, 'agents')}" 2>/dev/null`);
    if (agentsCheck.ok && agentsCheck.stdout.trim()) {
      const agents = agentsCheck.stdout.trim().split('\n').filter(Boolean);
      results.push({ name, dir, agents });
    }
  }

  return results;
}

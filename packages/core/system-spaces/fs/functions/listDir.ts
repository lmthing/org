/** List the entries (files and directories) in a directory. */
export function listDir(path: string): { ok: boolean; entries: string[]; error?: string } {
  const r = execShell(`ls -1A ${JSON.stringify(path)}`);
  if (!r.ok) return { ok: false, entries: [], error: r.stderr };
  return {
    ok: true,
    entries: r.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

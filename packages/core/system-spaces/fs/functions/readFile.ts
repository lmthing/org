/** Read a text file with 1-based line numbers (cat -n style). Use offset/limit for ranges. */
export function readFile(
  path: string,
  opts?: { offset?: number; limit?: number },
): { ok: boolean; content: string; lines: number; truncated: boolean; error?: string } {
  const r = readFileRaw(path, opts);
  if (!r.ok) return { ok: false, content: '', lines: 0, truncated: false, error: r.error };
  const startLine = (opts?.offset ?? 0) + 1;
  const numbered = r.content
    .split('\n')
    .map((line, i) => `${startLine + i}\t${line}`)
    .join('\n');
  return { ok: true, content: numbered, lines: r.lines, truncated: r.truncated };
}

/** Read a text file. `content` has 1-based line numbers (useful for referencing lines in editFile);
 *  `raw` has the unmodified text (use this for JSON.parse and structured data). */
export function readFile(
  path: string,
  opts?: { offset?: number; limit?: number },
): { ok: boolean; content: string; raw: string; lines: number; truncated: boolean; error?: string } {
  const r = readFileRaw(path, opts);
  if (!r.ok) return { ok: false, content: '', raw: '', lines: 0, truncated: false, error: r.error };
  const startLine = (opts?.offset ?? 0) + 1;
  const numbered = r.content
    .split('\n')
    .map((line, i) => `${startLine + i}\t${line}`)
    .join('\n');
  return { ok: true, content: numbered, raw: r.content, lines: r.lines, truncated: r.truncated };
}

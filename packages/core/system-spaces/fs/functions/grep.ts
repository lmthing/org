/** Search file contents for a pattern. Uses ripgrep, falling back to grep -rn. Returns file/line/text matches. */
export function grep(
  pattern: string,
  opts?: { path?: string; glob?: string; ignoreCase?: boolean; maxMatches?: number },
): { ok: boolean; matches: { file: string; line: number; text: string }[]; truncated: boolean; error?: string } {
  const path = opts?.path ?? '.';
  const max = opts?.maxMatches ?? 200;
  const ic = opts?.ignoreCase ? '-i ' : '';
  const globArg = opts?.glob ? `-g ${JSON.stringify(opts.glob)} ` : '';
  const matches: { file: string; line: number; text: string }[] = [];

  // Prefer ripgrep when available. Probe with `|| true` so a missing binary or a
  // no-match exit code never surfaces as an execShell error in the output.
  const hasRg = execShell('command -v rg || true').stdout.trim().length > 0;
  const rg = hasRg
    ? execShell(`rg --json ${ic}${globArg}-e ${JSON.stringify(pattern)} ${JSON.stringify(path)} || true`)
    : { ok: false, stdout: '', stderr: '' };
  if (rg.stdout.trim()) {
    for (const line of rg.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'match') {
          matches.push({
            file: ev.data.path.text,
            line: ev.data.line_number,
            text: String(ev.data.lines.text ?? '').replace(/\n$/, ''),
          });
          if (matches.length >= max) break;
        }
      } catch {
        // skip non-JSON noise
      }
    }
    return { ok: true, matches, truncated: matches.length >= max };
  }

  // Fallback: grep -rn (also handles "rg not installed"). `|| true` keeps a
  // no-match (exit 1) from being logged as an error.
  const grepFlags = opts?.glob ? `--include=${JSON.stringify(opts.glob)} ` : '';
  const gr = execShell(`grep -rnH ${ic}${grepFlags}-e ${JSON.stringify(pattern)} ${JSON.stringify(path)} || true`);
  if (gr.stdout.trim()) {
    for (const line of gr.stdout.split('\n')) {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (m) {
        matches.push({ file: m[1], line: parseInt(m[2], 10), text: m[3] });
        if (matches.length >= max) break;
      }
    }
  }
  return { ok: true, matches, truncated: matches.length >= max };
}

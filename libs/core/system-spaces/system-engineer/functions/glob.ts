/** Find files matching a glob pattern (supports ** and *) in your scratch sandbox. Skips node_modules and .git. */
export function glob(pattern: string, opts?: { cwd?: string }): { ok: boolean; paths: string[]; error?: string } {
  const cwd = opts?.cwd ?? '.';
  const r = scratchExec(
    `find ${JSON.stringify(cwd)} -type f -not -path '*/node_modules/*' -not -path '*/.git/*'`,
  );
  if (!r.ok) return { ok: false, paths: [], error: r.stderr };

  // Convert glob to a RegExp: ** → any chars, * → within-segment, ? → single char.
  const rx = (() => {
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*') {
        if (pattern[i + 1] === '*') {
          re += '.*';
          i++;
          if (pattern[i + 1] === '/') i++;
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') re += '[^/]';
      else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
      else re += c;
    }
    return new RegExp('(^|/)' + re + '$');
  })();

  const paths = r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('./') ? p.slice(2) : p))
    .filter((p) => rx.test(p))
    .sort()
    .slice(0, 1000);
  return { ok: true, paths };
}

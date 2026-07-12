/** Replace an exact string in a scratch-sandbox file (call createScratch() first). Fails if
 *  oldString is missing or non-unique (unless replaceAll). Paths resolve inside the scratch dir. */
export function editFile(
  path: string,
  oldString: string,
  newString: string,
  opts?: { replaceAll?: boolean },
): { ok: boolean; replacements: number; error?: string } {
  if (oldString === newString) {
    return { ok: false, replacements: 0, error: 'oldString and newString are identical' };
  }
  const r = scratchReadRaw(path);
  if (!r.ok) return { ok: false, replacements: 0, error: r.error };
  const count = r.content.split(oldString).length - 1;
  if (count === 0) {
    return { ok: false, replacements: 0, error: 'oldString not found in file' };
  }
  if (count > 1 && !opts?.replaceAll) {
    return {
      ok: false,
      replacements: 0,
      error: `oldString is not unique (${count} matches) — add surrounding context or pass { replaceAll: true }`,
    };
  }
  const replaced = opts?.replaceAll
    ? r.content.split(oldString).join(newString)
    : r.content.replace(oldString, newString);
  const w = scratchWriteRaw(path, replaced);
  if (!w.ok) return { ok: false, replacements: 0, error: w.error };
  return { ok: true, replacements: opts?.replaceAll ? count : 1 };
}

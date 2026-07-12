/** Strip a trailing file extension a model may bake into the name. */
function stripExt(name: string): string {
  return String(name).replace(/\.(md|tsx?|jsx?)$/i, '');
}

/**
 * Write a custom component for a space — one file. Only needed when the built-in
 * catalog (~30 display + ~33 form components) can't express the UI.
 *  - kind 'view' → `components/view/<name>.tsx` (read-only TSX, used with display()).
 *  - kind 'form' → `components/form/<name>.tsx` (single file, used with ask()).
 *
 * Both are a single default-export TSX built from catalog components (the legacy
 * form `web.tsx`/`ink.tsx` split is removed — see org/format/space/components/form.md). Uses only writeFileRaw.
 * No imports.
 *
 * @returns { ok, path, error? }
 */
export function writeComponentFile(
  space: string,
  kind: 'view' | 'form',
  name: string,
  source: string,
): { ok: boolean; path: string; error?: string } {
  const dir = resolveSpaceDir(space);
  const compName = stripExt(name ?? '');
  if (!compName) return { ok: false, path: '', error: 'writeComponentFile: name is required' };
  if (kind !== 'view' && kind !== 'form') {
    return { ok: false, path: '', error: `writeComponentFile: kind must be 'view' or 'form' (got ${JSON.stringify(kind)})` };
  }
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, path: '', error: 'writeComponentFile: source must be a non-empty string' };
  }

  const path = spacePath(dir, 'components', kind, `${compName}.tsx`);
  const w = writeFileRaw(path, source);
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };
  return { ok: true, path };
}

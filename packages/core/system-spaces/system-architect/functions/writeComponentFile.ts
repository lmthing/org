/** Join path segments with '/'. Replaces node:path.join inside the QuickJS VM. */
function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

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
 * form `web.tsx`/`ink.tsx` split is removed — see SPACE-SPEC). Uses only writeFileRaw.
 * No imports.
 *
 * @returns { ok, path, error? }
 */
/** Resolve a space arg to its absolute directory. The model passes only a bare slug
 *  and NEVER needs to know where spaces are stored — this resolves it under the
 *  host-injected project spaces dir (process.env.LMTHING_PROJECT_SPACES_DIR =
 *  .lmthing/<project>/spaces, default .lmthing/user/spaces). A value already containing
 *  "/" is used verbatim (the iterate flow passes a discovered dir). */
function resolveSpaceDir(space: string): string {
  const s = String(space ?? '').replace(/\/+$/, '');
  if (s.includes('/')) return s;
  const base = (process.env.LMTHING_PROJECT_SPACES_DIR || '.lmthing/user/spaces').replace(/\/+$/, '');
  return joinPath(base, s);
}

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

  const path = joinPath(dir, 'components', kind, `${compName}.tsx`);
  const w = writeFileRaw(path, source);
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };
  return { ok: true, path };
}

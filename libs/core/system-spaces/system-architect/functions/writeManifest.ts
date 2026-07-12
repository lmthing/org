/**
 * Write a space's `package.json` manifest — the store-facing metadata block. `manifest`
 * is a plain object serialized verbatim; it MUST carry a `name` (the space's package
 * name). The `lmthing` block (tags, settings JSON Schema, provider config) rides along as
 * whatever keys the caller includes. Overwrites in place. No imports.
 *
 * @returns { ok, path, error? }
 */
export function writeManifest(
  space: string,
  manifest: Record<string, unknown>,
): { ok: boolean; path: string; error?: string } {
  const dir = resolveSpaceDir(space);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, path: '', error: 'writeManifest: manifest must be an object' };
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    return { ok: false, path: '', error: 'writeManifest: manifest.name (the package name) is required' };
  }

  const path = spacePath(dir, 'package.json');
  const w = writeFileRaw(path, JSON.stringify(manifest, null, 2) + '\n');
  if (!w.ok) return { ok: false, path, error: `Failed to write ${path}: ${w.error}` };
  return { ok: true, path };
}

/** Strip a trailing file extension a model may bake into the slug. */
function stripHookExt(name: string): string {
  return String(name).replace(/\.(md|tsx?|jsx?)$/i, '');
}

/**
 * Write a single space EVENT-HOOK consumer `hooks/<slug>.ts` — a default-exported handler
 * with `{ type: 'event', ... }` config that reacts to an event on the bus. Typechecks the
 * source on the spot via `typecheckSource` (unresolved sibling names are not treated as
 * errors), rejects `import`s, and requires a `default` export. Overwrites in place. No imports.
 *
 * @returns { ok, path, errors } — when `ok` is false, `errors` holds the typecheck/write
 *          diagnostics for the model to fix and re-call.
 */
export function writeHookFile(
  space: string,
  slug: string,
  source: string,
): { ok: boolean; path: string; errors: string[] } {
  const dir = resolveSpaceDir(space);
  const hookSlug = stripHookExt(slug ?? '');
  if (!hookSlug) return { ok: false, path: '', errors: ['writeHookFile: slug is required'] };
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, path: '', errors: ['writeHookFile: source must be a non-empty string'] };
  }
  if (/^\s*import\s/m.test(source)) {
    return { ok: false, path: '', errors: ['hook uses a forbidden `import` statement (host has no module system) — inline everything'] };
  }
  if (!/export\s+default/.test(source)) {
    return { ok: false, path: '', errors: ['hook has no `export default` — a hooks/*.ts must default-export a handler with { type: \'event\' } config'] };
  }

  const tc = typecheckSource(source);
  if (!tc.ok) return { ok: false, path: '', errors: tc.errors };

  const path = spacePath(dir, 'hooks', `${hookSlug}.ts`);
  const w = writeFileRaw(path, source);
  if (!w.ok) return { ok: false, path, errors: [`Failed to write ${path}: ${w.error}`] };
  return { ok: true, path, errors: [] };
}

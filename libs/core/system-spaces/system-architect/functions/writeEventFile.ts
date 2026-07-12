/** Strip a trailing file extension a model may bake into the name. */
function stripEventExt(name: string): string {
  return String(name).replace(/\.(md|tsx?|jsx?)$/i, '');
}

/**
 * Write a single space EMITTER DEF `events/<name>.ts` — a default-exported typed
 * `EmitterDef` (`webhook`/`cron`/`db`/`internal`) that makes the space an EVENT SOURCE
 * on the bus. Typechecks the source on the spot via `typecheckSource` (unresolved sibling
 * names are not treated as errors), rejects `import`s, and requires a `default` export.
 * Overwrites in place. No imports.
 *
 * @returns { ok, path, errors } — when `ok` is false, `errors` holds the typecheck/write
 *          diagnostics for the model to fix and re-call.
 */
export function writeEventFile(
  space: string,
  name: string,
  source: string,
): { ok: boolean; path: string; errors: string[] } {
  const dir = resolveSpaceDir(space);
  const evName = stripEventExt(name ?? '');
  if (!evName) return { ok: false, path: '', errors: ['writeEventFile: name is required'] };
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, path: '', errors: ['writeEventFile: source must be a non-empty string'] };
  }
  if (/^\s*import\s/m.test(source)) {
    return { ok: false, path: '', errors: ['emitter def uses a forbidden `import` statement (host has no module system) — inline everything'] };
  }
  if (!/export\s+default/.test(source)) {
    return { ok: false, path: '', errors: ['emitter def has no `export default` — an events/*.ts must default-export a typed EmitterDef'] };
  }

  const tc = typecheckSource(source);
  if (!tc.ok) return { ok: false, path: '', errors: tc.errors };

  const path = spacePath(dir, 'events', `${evName}.ts`);
  const w = writeFileRaw(path, source);
  if (!w.ok) return { ok: false, path, errors: [`Failed to write ${path}: ${w.error}`] };
  return { ok: true, path, errors: [] };
}

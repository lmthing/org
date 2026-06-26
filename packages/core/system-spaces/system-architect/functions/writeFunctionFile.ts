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
 * Write a single space function file `functions/<name>.ts` AND typecheck its source
 * on the spot via the host `typecheckSource` primitive, so a syntax/type error is
 * reported immediately (this turn) rather than only when the synthesized agent later
 * invokes the function. Overwrites in place. No imports.
 *
 * Functions must be single-export TS using only host primitives (readFileRaw,
 * writeFileRaw, execShell, fetch, process.env) and may reference sibling space
 * functions — unresolved-name diagnostics are NOT treated as errors by typecheckSource.
 *
 * @returns { ok, path, errors } — when `ok` is false, `errors` holds the typecheck
 *          (or write) diagnostics for the model to fix and re-call.
 */
export function writeFunctionFile(
  dir: string,
  name: string,
  source: string,
): { ok: boolean; path: string; errors: string[] } {
  const fnName = stripExt(name ?? '');
  if (!fnName) return { ok: false, path: '', errors: ['writeFunctionFile: name is required'] };
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, path: '', errors: ['writeFunctionFile: source must be a non-empty string'] };
  }

  // Reject imports up front — the QuickJS host has no module system.
  if (/^\s*import\s/m.test(source)) {
    return { ok: false, path: '', errors: ['function uses a forbidden `import` statement (host has no module system) — inline everything'] };
  }
  if (!/export\s+(function|const|default)/.test(source)) {
    return { ok: false, path: '', errors: ['function has no `export` — it will not be callable; use `export function` or `export const`'] };
  }

  const tc = typecheckSource(source);
  if (!tc.ok) {
    return { ok: false, path: '', errors: tc.errors };
  }

  const path = joinPath(dir, 'functions', `${fnName}.ts`);
  const w = writeFileRaw(path, source);
  if (!w.ok) return { ok: false, path, errors: [`Failed to write ${path}: ${w.error}`] };
  return { ok: true, path, errors: [] };
}

import type { VM } from './quickjs.js';
import { transpileStatement } from '../typecheck/transpile.js';

/**
 * Strip ESM export syntax so a function module binds into script scope, forcing
 * the binding name to `name` regardless of the in-file identifier.
 *
 *   export default function foo() {}  ->  function <name> () {}
 *   export default <expr>             ->  const <name> = <expr>
 *   export <decl>                     ->  <decl>
 */
function stripExports(js: string, name: string): string {
  return js
    .replace(/^export\s+default\s+function\s+/gm, `function ${name} `)
    .replace(/^export\s+default\s+/gm, `const ${name} = `)
    .replace(/^export\s+/gm, '');
}

/**
 * Inject space functions into a VM as globals — the single source of truth for
 * function injection, used by the session VM, fork VMs, and delegate VMs (these
 * previously carried three byte-identical copies of this loop).
 *
 * For each function the bundled JS is used when present (esbuild output for
 * spaces with node_modules), otherwise the TS source is transpiled. Export
 * syntax is stripped and the function is bound to globalThis under its map key.
 *
 * Injection is best-effort: a single function that fails to eval calls `onWarn`
 * (with the function name and error) rather than throwing, so one bad function
 * doesn't abort the rest.
 */
export function injectSpaceFunctions(
  vm: VM,
  functions: Record<string, string>,
  functionsBundled: Record<string, string>,
  onWarn: (name: string, error: string) => void,
): void {
  for (const name of Object.keys(functions)) {
    const bundled = functionsBundled[name];
    const js = bundled
      ? stripExports(bundled, name)
      : stripExports(transpileStatement(functions[name]!), name);
    const result = vm.evalScript(`${js}\nglobalThis['${name}'] = ${name};`);
    if (!result.ok) {
      onWarn(name, result.error ?? 'unknown error');
    }
  }
}

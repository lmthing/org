import type { VM } from './quickjs.js';
import { transpileStatement } from '../typecheck/transpile.js';
import { functionRequiresConsent } from '../globals/consent.js';

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
 * Wrap a consent-marked function (leading `@consent` pragma — plan S10) so its
 * invocation yields to the HOST for user approval before the implementation
 * runs. The impl is hidden in a closure (never bound to globalThis), so sandbox
 * code cannot reach the unwrapped function — the `__requestConsent` yield
 * (globals/consent.ts) is the only way in, and the host's consent gate
 * (yield-router `consent` case) decides. Denial rejects; the impl never runs.
 * NOTE: the wrapper is necessarily Promise-returning even for a synchronous
 * source function — consent must yield the turn.
 */
export function wrapWithConsentGate(name: string, js: string): string {
  return `globalThis['${name}'] = (function () {
${js}
  var __impl = ${name};
  return function () {
    var __args = Array.prototype.slice.call(arguments);
    return __requestConsent(${JSON.stringify(name)}, __args).then(function () {
      return __impl.apply(null, __args);
    });
  };
})();`;
}

/**
 * Inject space functions into a VM as globals — the single source of truth for
 * function injection, used by the session VM, fork VMs, and delegate VMs (these
 * previously carried three byte-identical copies of this loop).
 *
 * For each function the bundled JS is used when present (esbuild output for
 * spaces with node_modules), otherwise the TS source is transpiled. Export
 * syntax is stripped and the function is bound to globalThis under its map key.
 * A function whose ORIGINAL TS source opts into consent (leading `@consent`
 * pragma — bundling may strip comments, so detection is always on the source)
 * is bound via {@link wrapWithConsentGate} instead of directly.
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
    const script = functionRequiresConsent(functions[name]!)
      ? wrapWithConsentGate(name, js)
      : `${js}\nglobalThis['${name}'] = ${name};`;
    const result = vm.evalScript(script);
    if (!result.ok) {
      onWarn(name, result.error ?? 'unknown error');
    }
  }
}

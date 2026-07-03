/**
 * Load an esbuild-transpiled (CJS) handler module from a **code string** — no
 * file path, no TS toolchain, no repo access (the worker runs handlers this way,
 * which is the crash-boundary invariant: the only way the worker touches state is
 * the `ctx` proxies).
 *
 * The handler source is authored as ESM (`export const name`, `export default
 * async function handler`, `import { HttpError } from '@app/runtime'`). It is
 * transpiled to CJS (`format: 'cjs'`) in the main process, then this helper
 * evaluates that CJS string in a fresh module scope. A tiny `require` shim
 * resolves **`@app/runtime`** (the handler's public import surface — for now just
 * `HttpError`); any other bare import falls back to the real `require` (project
 * npm deps are available in the worker's node_modules at runtime).
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

import { HttpError } from './errors.js';

/** The subset of a handler module the runtime cares about. */
export interface LoadedHandlerModule {
  /** The stable agent-facing endpoint id (`export const name`). */
  name?: string;
  /** Human/agent-facing description (`export const description`). */
  description?: string;
  /** The default-exported `async (input, ctx) => Output` handler. */
  handler?: (input: unknown, ctx: unknown) => unknown;
}

/** The module surface handlers may `import` from `@app/runtime`. */
const APP_RUNTIME_MODULE = { HttpError } as const;

// Base a real `require` at the process cwd so a handler's bare imports resolve
// against the project's node_modules. A cwd-anchored path (not `import.meta.url`)
// keeps this working when bundled into the `eval:true` worker, which has no
// meaningful `import.meta`/`__filename`.
const realRequire = createRequire(join(process.cwd(), 'lmthing-app-handler.cjs'));

/**
 * Evaluate a CJS handler-module string and return its exports. Runs the module's
 * top-level code (which only wires exports for a well-formed handler) — it does
 * **not** invoke the handler. Throwing top-level code propagates to the caller
 * (in the worker that becomes a 500; the loader avoids this path by static-
 * parsing `name` instead of evaluating).
 */
export function loadHandlerFromCode(code: string): LoadedHandlerModule {
  const shimRequire = (id: string): unknown => {
    if (id === '@app/runtime') return APP_RUNTIME_MODULE;
    return realRequire(id);
  };
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', 'require', code);
  fn(moduleObj, moduleObj.exports, shimRequire);

  const exp = moduleObj.exports as Record<string, unknown>;
  return {
    name: typeof exp.name === 'string' ? exp.name : undefined,
    description: typeof exp.description === 'string' ? exp.description : undefined,
    handler:
      typeof exp.default === 'function'
        ? (exp.default as LoadedHandlerModule['handler'])
        : typeof exp.handler === 'function'
          ? (exp.handler as LoadedHandlerModule['handler'])
          : undefined,
  };
}

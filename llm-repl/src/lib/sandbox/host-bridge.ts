/**
 * Handle-marshaling pattern for host functions in QuickJS.
 * Bridges between the QuickJS VM and the Node.js host.
 */
import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten';

// ── Marshal host → QuickJS ──

export function marshalToQuickJS(
  ctx: QuickJSAsyncContext,
  value: unknown,
): QuickJSHandle {
  if (value === null || value === undefined) {
    return ctx.null;
  }
  if (typeof value === 'boolean') {
    return value ? ctx.true : ctx.false;
  }
  if (typeof value === 'number') {
    return ctx.newNumber(value);
  }
  if (typeof value === 'string') {
    return ctx.newString(value);
  }
  if (Array.isArray(value)) {
    const arr = ctx.newArray();
    for (let i = 0; i < value.length; i++) {
      const elemHandle = marshalToQuickJS(ctx, value[i]);
      ctx.setProp(arr, i, elemHandle);
      elemHandle.dispose();
    }
    return arr;
  }
  if (typeof value === 'object') {
    const obj = ctx.newObject();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const valHandle = marshalToQuickJS(ctx, v);
      ctx.setProp(obj, k, valHandle);
      valHandle.dispose();
    }
    return obj;
  }
  // Fallback: stringify non-primitives
  return ctx.newString(String(value));
}

// ── Marshal QuickJS → host ──

export function marshalToHost(
  ctx: QuickJSAsyncContext,
  handle: QuickJSHandle,
): unknown {
  return ctx.dump(handle);
}

// ── Inject a host function as a global ──

export function injectGlobal(
  ctx: QuickJSAsyncContext,
  name: string,
  fn: (...args: unknown[]) => unknown | Promise<unknown>,
): void {
  const fnHandle = ctx.newFunction(name, (...argHandles: QuickJSHandle[]) => {
    const args = argHandles.map((h) => marshalToHost(ctx, h));
    const result = fn(...args);
    if (result instanceof Promise) {
      const deferred = ctx.newPromise();
      result
        .then((v) => {
          const handle = marshalToQuickJS(ctx, v);
          deferred.resolve(handle);
          handle.dispose();
          ctx.runtime.executePendingJobs();
        })
        .catch((err: unknown) => {
          const errHandle = ctx.newString(
            err instanceof Error ? err.message : String(err),
          );
          deferred.reject(errHandle);
          errHandle.dispose();
          ctx.runtime.executePendingJobs();
        });
      return deferred.handle;
    }
    return marshalToQuickJS(ctx, result);
  });

  ctx.setProp(ctx.global, name, fnHandle);
  fnHandle.dispose();
}

// ── JSX runtime injection ──

/**
 * Inject a virtual jsx-runtime that produces plain descriptor objects.
 * Components defined in the sandbox return { $$type, props, key } trees
 * which the host renderer re-hydrates.
 */
export function injectJsxRuntime(ctx: QuickJSAsyncContext): void {
  const jsxRuntimeCode = `
globalThis.__jsxRuntime = {
  jsx: function(type, props, key) {
    return { $$type: type, props: props || {}, key: key !== undefined ? key : null };
  },
  jsxs: function(type, props, key) {
    return { $$type: type, props: props || {}, key: key !== undefined ? key : null };
  },
  Fragment: '__Fragment__',
};
`;
  const result = ctx.evalCode(jsxRuntimeCode, 'jsx-runtime.js');
  if (result.error !== undefined) {
    const msg = ctx.dump(result.error);
    result.error.dispose();
    throw new Error(`Failed to inject JSX runtime: ${JSON.stringify(msg)}`);
  }
  if (result.value !== undefined) {
    result.value.dispose();
  }
}

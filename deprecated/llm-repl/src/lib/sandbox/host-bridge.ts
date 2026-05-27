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
  if (typeof value === 'function') {
    // Wrap host function as a callable QuickJS handle. Without this, host
    // functions returned as object properties (e.g. tasklist().start) would
    // hit the String() fallback and become strings — calls would throw
    // "not a function" inside the sandbox.
    return wrapHostFunction(ctx, value as (...args: unknown[]) => unknown);
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

function wrapHostFunction(
  ctx: QuickJSAsyncContext,
  fn: (...args: unknown[]) => unknown,
): QuickJSHandle {
  return ctx.newFunction(fn.name || 'anonymous', (...argHandles: QuickJSHandle[]) => {
    const args = argHandles.map((h) => marshalToHost(ctx, h));
    let result: unknown;
    try {
      result = fn(...args);
    } catch (err) {
      // Surface host throw as QuickJS throw, not a silent string.
      const errHandle = ctx.newError(err instanceof Error ? err : new Error(String(err)));
      // Throwing inside a host-function callback is signalled by returning
      // the error handle wrapped in a special way; in this codebase we just
      // dispatch as a thrown Error via the bridge's host-throw path. The
      // simplest correct behavior is to re-marshal undefined and rely on
      // QuickJS to surface the error from a subsequent .then; but for sync
      // calls we throw via ctx.throw and return undefined.
      ctx.throw(errHandle);
      errHandle.dispose();
      return ctx.undefined;
    }
    if (result instanceof Promise) {
      const deferred = ctx.newPromise();
      result
        .then((v) => {
          const h = marshalToQuickJS(ctx, v);
          deferred.resolve(h);
          h.dispose();
          ctx.runtime.executePendingJobs();
        })
        .catch((e: unknown) => {
          const eHandle = ctx.newString(e instanceof Error ? e.message : String(e));
          deferred.reject(eHandle);
          eHandle.dispose();
          ctx.runtime.executePendingJobs();
        });
      return deferred.handle;
    }
    return marshalToQuickJS(ctx, result);
  });
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
    // marshalToHost copies the value out; the underlying QuickJS handles are
    // not borrowed long-term by the host. QuickJS owns argHandles itself for
    // C-to-host bridges (WeakLifetime), so we must NOT dispose them here.
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

import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten';

/**
 * Marshal a host value into a QuickJS handle.
 * Caller is responsible for disposing the returned handle when done.
 */
export function marshalToQuickJS(ctx: QuickJSAsyncContext, value: unknown): QuickJSHandle {
  if (value === null) return ctx.null;
  if (value === undefined) return ctx.undefined;
  if (typeof value === 'boolean') return value ? ctx.true : ctx.false;
  if (typeof value === 'number') return ctx.newNumber(value);
  if (typeof value === 'string') return ctx.newString(value);

  if (Array.isArray(value)) {
    const arr = ctx.newArray();
    for (let i = 0; i < value.length; i++) {
      const item = marshalToQuickJS(ctx, value[i]);
      ctx.setProp(arr, i, item);
      item.dispose();
    }
    return arr;
  }

  if (typeof value === 'function') {
    const fn = ctx.newFunction(value.name || 'anonymous', (...vmArgs: QuickJSHandle[]) => {
      const hostArgs = vmArgs.map((a) => ctx.dump(a));
      const result = (value as (...args: unknown[]) => unknown)(...hostArgs);
      if (result instanceof Promise) {
        const deferred = ctx.newPromise();
        result.then(
          (resolved) => {
            const qjsResolved = marshalToQuickJS(ctx, resolved);
            deferred.resolve(qjsResolved);
            qjsResolved.dispose();
            ctx.runtime.executePendingJobs();
          },
          (err: unknown) => {
            const errStr = err instanceof Error ? err.message : String(err);
            const qjsErr = ctx.newString(errStr);
            deferred.reject(qjsErr);
            qjsErr.dispose();
            ctx.runtime.executePendingJobs();
          },
        );
        const promiseHandle = deferred.handle.dup();
        deferred.dispose();
        return promiseHandle;
      }
      return marshalToQuickJS(ctx, result);
    });
    return fn;
  }

  if (typeof value === 'object') {
    const obj = ctx.newObject();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const qjsVal = marshalToQuickJS(ctx, v);
      ctx.setProp(obj, k, qjsVal);
      qjsVal.dispose();
    }
    return obj;
  }

  // Fallback: convert to string
  return ctx.newString(String(value));
}

/**
 * Marshal a QuickJS handle back to a host value.
 */
export function marshalToHost(ctx: QuickJSAsyncContext, handle: QuickJSHandle): unknown {
  return ctx.dump(handle);
}

/**
 * Inject a host function as a global in the QuickJS context.
 */
export function injectGlobal(
  ctx: QuickJSAsyncContext,
  name: string,
  fn: (...args: unknown[]) => unknown,
): void {
  const fnHandle = marshalToQuickJS(ctx, fn);
  ctx.setProp(ctx.global, name, fnHandle);
  fnHandle.dispose();
}

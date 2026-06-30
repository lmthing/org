import type { QuickJSAsyncContext, QuickJSDeferredPromise, QuickJSHandle } from 'quickjs-emscripten';

/**
 * Deferreds created by a bridged host function call (see `marshalToQuickJS`'s
 * function branch) that haven't settled yet, keyed by context. A deferred whose
 * host promise never resolves/rejects before the VM is torn down (budget cap,
 * fork timeout) would otherwise be disposed (see `disposePendingDeferreds`,
 * called by `quickjs.ts`'s `dispose()`) — `QuickJSContext#dispose()` throws if any
 * handle it created is still alive, so an un-settled deferred left dangling
 * would break VM teardown.
 */
const pendingDeferreds = new WeakMap<QuickJSAsyncContext, Set<QuickJSDeferredPromise>>();

function trackDeferred(ctx: QuickJSAsyncContext, deferred: QuickJSDeferredPromise): void {
  let set = pendingDeferreds.get(ctx);
  if (!set) {
    set = new Set();
    pendingDeferreds.set(ctx, set);
  }
  set.add(deferred);
}

function untrackDeferred(ctx: QuickJSAsyncContext, deferred: QuickJSDeferredPromise): void {
  pendingDeferreds.get(ctx)?.delete(deferred);
}

/**
 * Force-dispose any bridged-call deferreds that never settled before VM teardown.
 * Call this BEFORE `ctx.dispose()`.
 */
export function disposePendingDeferreds(ctx: QuickJSAsyncContext): void {
  const set = pendingDeferreds.get(ctx);
  if (!set) return;
  for (const deferred of set) {
    if (deferred.handle.alive) {
      try { deferred.dispose(); } catch { /* already gone */ }
    }
  }
  set.clear();
}

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
        trackDeferred(ctx, deferred);
        // Dispose AFTER settling, not before: `resolve`/`reject` are no-ops once
        // `dispose()` has run (quickjs-emscripten), so disposing eagerly here — before
        // `result` (the host promise) has actually settled — permanently neuters the
        // deferred. That silently breaks any await chained through this promise from
        // inside another function (the module's own top-level await still appears to
        // "work" only because turn-loop separately re-injects the resolved value via
        // `vm.setVar`, but a NESTED await — e.g. a space function doing
        // `await fetch(...)` internally — would hang forever on a promise that can
        // never resolve).
        // Settling is async (the host operation resolves on its own schedule), so the
        // VM/context may already be disposed by the time it fires (budget exceeded,
        // fork timed out, session torn down). Guard every step — touching a disposed
        // ctx/runtime throws — and swallow rather than producing an unhandled rejection
        // that Node would otherwise attribute to whatever unrelated test/turn is running
        // when the callback happens to fire.
        result.then(
          (resolved) => {
            if (!ctx.alive || !ctx.runtime.alive || !deferred.handle.alive) { untrackDeferred(ctx, deferred); return; }
            try {
              const qjsResolved = marshalToQuickJS(ctx, resolved);
              deferred.resolve(qjsResolved);
              qjsResolved.dispose();
              ctx.runtime.executePendingJobs();
            } catch {
              /* ctx/runtime disposed mid-flight — nothing left to resolve into */
            } finally {
              if (deferred.handle.alive) deferred.dispose();
              untrackDeferred(ctx, deferred);
            }
          },
          (err: unknown) => {
            if (!ctx.alive || !ctx.runtime.alive || !deferred.handle.alive) { untrackDeferred(ctx, deferred); return; }
            try {
              const errStr = err instanceof Error ? err.message : String(err);
              const qjsErr = ctx.newString(errStr);
              deferred.reject(qjsErr);
              qjsErr.dispose();
              ctx.runtime.executePendingJobs();
            } catch {
              /* ctx/runtime disposed mid-flight — nothing left to reject into */
            } finally {
              if (deferred.handle.alive) deferred.dispose();
              untrackDeferred(ctx, deferred);
            }
          },
        );
        const promiseHandle = deferred.handle.dup();
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

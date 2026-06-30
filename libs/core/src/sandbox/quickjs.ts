import {
  newQuickJSAsyncWASMModule,
  shouldInterruptAfterDeadline,
  type QuickJSAsyncContext,
  type QuickJSAsyncRuntime,
  type QuickJSAsyncWASMModule,
  type QuickJSHandle,
} from 'quickjs-emscripten';
import type { YieldRequest } from '../eval/yield.js';
import { disposePendingDeferreds } from './host-bridge.js';

export type EvalResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface VMOpts {
  memoryLimitBytes?: number;
  maxStatementMs?: number;
}

export interface VM {
  evalStatement(code: string): EvalResult;
  evalScript(code: string): EvalResult;
  drivePendingJobs(): EvalResult;
  getScope(): Record<string, unknown>;
  setVar(name: string, value: unknown): void;
  /** Read a global's current value back out of the VM (e.g. to recover the real
   *  value of a binding whose yielding call was nested inside another async
   *  function — see turn-loop's post-yield binding). Returns `undefined` if the
   *  global is unset or its value can't be dumped. */
  getVar(name: string): unknown;
  dispose(): void;
  pendingYields: YieldRequest[];
  ctx: QuickJSAsyncContext;
}

let wasmModulePromise: Promise<QuickJSAsyncWASMModule> | null = null;

function getWASMModule(): Promise<QuickJSAsyncWASMModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = newQuickJSAsyncWASMModule();
  }
  return wasmModulePromise;
}

export async function createVM(opts: VMOpts = {}): Promise<VM> {
  const memLimit = opts.memoryLimitBytes ?? 64 * 1024 * 1024;
  const maxMs = opts.maxStatementMs ?? 5000;

  const wasmModule = await getWASMModule();
  const runtime: QuickJSAsyncRuntime = wasmModule.newRuntime();
  runtime.setMemoryLimit(memLimit);

  const ctx: QuickJSAsyncContext = runtime.newContext();
  const scope: Record<string, unknown> = {};
  const pendingYields: YieldRequest[] = [];

  /** Dump a QuickJS error handle to a host string (message field when present). */
  function dumpError(handle: QuickJSHandle): string {
    const errMsg = ctx.dump(handle);
    return errMsg && typeof errMsg === 'object'
      ? ((errMsg as Record<string, unknown>)['message'] as string | undefined) ?? JSON.stringify(errMsg)
      : String(errMsg);
  }

  /**
   * Evaluate a statement synchronously using evalCode (not evalCodeAsync).
   * Drives executePendingJobs until a yield is detected or all jobs exhaust.
   * Returns immediately when pendingYields is non-empty (yield detected).
   *
   * This avoids the evalCodeAsync deadlock: when the VM awaits a host promise
   * that only resolves after user input, evalCodeAsync would block forever.
   * With sync evalCode + manual job driving we can detect the yield and return.
   */
  function evalStatement(code: string): EvalResult {
    const deadline = Date.now() + maxMs;
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

    let result;
    try {
      // Sync eval: dispatches module, returns immediately even if it has top-level await
      result = ctx.evalCode(code, '_session.tsx', { type: 'module' });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      runtime.setInterruptHandler(() => false);
    }

    if (result.error) {
      const msg = dumpError(result.error);
      result.error.dispose();
      return { ok: false, error: msg };
    }

    // For a module with top-level await, result.value is the module's evaluation
    // promise. Keep it alive across job-driving so we can inspect its final state.
    const moduleHandle = result.value;
    const driven = drivePendingJobs();
    if (!driven.ok || pendingYields.length > 0) {
      // Either a job-level error, or the module is legitimately suspended on a yield
      // (its promise is pending while the host resolves the yield) — not a failure.
      moduleHandle.dispose();
      return driven;
    }

    // Jobs drained with no pending yield. A top-level `await` that threw — e.g.
    // calling a global that wasn't injected (`await missingGlobal()`) — rejects the
    // module promise, which executePendingJobs swallows as an unhandled rejection.
    // Inspect the promise and surface the rejection as a turn error instead of
    // silently continuing (which would mask the model's mistake).
    let outcome: EvalResult = driven;
    try {
      const state = ctx.getPromiseState(moduleHandle);
      if (state.type === 'rejected') {
        const msg = dumpError(state.error);
        state.error.dispose();
        outcome = { ok: false, error: msg };
      } else if (state.type === 'fulfilled' && !state.notAPromise) {
        // A real resolved promise hands back a distinct value handle to free; for a
        // non-promise (module without top-level await) state.value IS moduleHandle,
        // so leave it for the single dispose below to avoid a double-free.
        state.value.dispose();
      }
    } catch {
      /* getPromiseState unavailable for this value — nothing to inspect */
    }
    moduleHandle.dispose();
    return outcome;
  }

  /**
   * Drive the event loop until a yield is detected or all pending jobs exhaust.
   * Call this after resolving a yield's deferred to run the VM continuation.
   */
  function drivePendingJobs(): EvalResult {
    let jobsResult = runtime.executePendingJobs(1);
    while (true) {
      if (pendingYields.length > 0) {
        // Yield detected — VM is suspended waiting for a host promise
        return { ok: true, value: undefined };
      }
      if ('error' in jobsResult && jobsResult.error !== undefined) {
        const msg = dumpError(jobsResult.error);
        jobsResult.error.dispose();
        return { ok: false, error: msg };
      }
      if (jobsResult.value === 0) {
        // No more pending jobs
        break;
      }
      jobsResult = runtime.executePendingJobs(1);
    }
    return { ok: true, value: undefined };
  }

  function getScope(): Record<string, unknown> {
    return { ...scope };
  }

  function setVar(name: string, value: unknown): void {
    scope[name] = value;
    const handle = marshalSimple(ctx, value);
    ctx.setProp(ctx.global, name, handle);
    handle.dispose();
  }

  function getVar(name: string): unknown {
    const handle = ctx.getProp(ctx.global, name);
    try {
      return ctx.dump(handle);
    } catch {
      return undefined;
    } finally {
      handle.dispose();
    }
  }

  /**
   * Eval code in script mode (not module mode). Used for injecting utility functions
   * that need to bind to globalThis rather than export from a module.
   */
  function evalScript(code: string): EvalResult {
    let result;
    try {
      result = ctx.evalCode(code, '_inject.js');
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (result.error) {
      const msg = dumpError(result.error);
      result.error.dispose();
      return { ok: false, error: msg };
    }
    result.value.dispose();
    return { ok: true, value: undefined };
  }

  function dispose(): void {
    // A bridged host call whose promise never settled before teardown (budget cap,
    // fork timeout) would otherwise leave a live QuickJS handle behind — ctx.dispose()
    // throws if any handle it created is still alive.
    disposePendingDeferreds(ctx);
    ctx.dispose();
    runtime.dispose();
  }

  return { evalStatement, evalScript, drivePendingJobs, getScope, setVar, getVar, dispose, pendingYields, ctx };
}

function marshalSimple(ctx: QuickJSAsyncContext, value: unknown): ReturnType<typeof ctx.newString> {
  if (value === null) return ctx.null;
  if (value === undefined) return ctx.undefined;
  if (typeof value === 'boolean') return value ? ctx.true : ctx.false;
  if (typeof value === 'number') return ctx.newNumber(value);
  if (typeof value === 'string') return ctx.newString(value);
  if (Array.isArray(value)) {
    const arr = ctx.newArray();
    for (let i = 0; i < value.length; i++) {
      const item = marshalSimple(ctx, (value as unknown[])[i]);
      ctx.setProp(arr, i, item);
      item.dispose();
    }
    return arr;
  }
  if (typeof value === 'object') {
    const obj = ctx.newObject();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const h = marshalSimple(ctx, v);
      ctx.setProp(obj, k, h);
      h.dispose();
    }
    return obj;
  }
  return ctx.newString(String(value));
}

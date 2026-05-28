import {
  newQuickJSAsyncWASMModule,
  shouldInterruptAfterDeadline,
  type QuickJSAsyncContext,
  type QuickJSAsyncRuntime,
  type QuickJSAsyncWASMModule,
} from 'quickjs-emscripten';
import type { YieldRequest } from '../eval/yield.js';

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
      const errMsg = ctx.dump(result.error);
      result.error.dispose();
      const msg =
        errMsg && typeof errMsg === 'object'
          ? ((errMsg as Record<string, unknown>)['message'] as string | undefined) ??
            JSON.stringify(errMsg)
          : String(errMsg);
      return { ok: false, error: msg };
    }
    result.value.dispose();

    return drivePendingJobs();
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
        const errMsg = ctx.dump(jobsResult.error);
        jobsResult.error.dispose();
        const msg =
          errMsg && typeof errMsg === 'object'
            ? ((errMsg as Record<string, unknown>)['message'] as string | undefined) ??
              JSON.stringify(errMsg)
            : String(errMsg);
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
      const errMsg = ctx.dump(result.error);
      result.error.dispose();
      const msg =
        errMsg && typeof errMsg === 'object'
          ? ((errMsg as Record<string, unknown>)['message'] as string | undefined) ??
            JSON.stringify(errMsg)
          : String(errMsg);
      return { ok: false, error: msg };
    }
    result.value.dispose();
    return { ok: true, value: undefined };
  }

  function dispose(): void {
    ctx.dispose();
    runtime.dispose();
  }

  return { evalStatement, evalScript, drivePendingJobs, getScope, setVar, dispose, pendingYields, ctx };
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

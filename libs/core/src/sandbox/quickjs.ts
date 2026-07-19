import {
  newQuickJSAsyncWASMModule,
  newQuickJSAsyncWASMModuleFromVariant,
  DEBUG_ASYNC,
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
  /** True while the underlying context AND runtime are both still alive. A long yield
   *  (e.g. a multi-minute nested delegate) can be resolved AFTER the VM was torn down
   *  out of band (idle reaper, capacity/memory eviction). The turn loop checks this
   *  before resuming so it ends the turn cleanly instead of throwing the opaque QuickJS
   *  "Lifetime not alive" from a resume op on a disposed handle. */
  isAlive(): boolean;
  /** Read a global's current value back out of the VM (e.g. to recover the real
   *  value of a binding whose yielding call was nested inside another async
   *  function — see turn-loop's post-yield binding). Returns `undefined` if the
   *  global is unset or its value can't be dumped. */
  getVar(name: string): unknown;
  dispose(): void;
  pendingYields: YieldRequest[];
  ctx: QuickJSAsyncContext;
}

// Each VM gets its OWN WebAssembly module instance. Asyncified module state
// (suspension bookkeeping, and the teardown corruption behind the swallowed
// `gc_obj_list` assertion) is shared across every runtime created inside one
// module — quickjs-emscripten's docs call this out as the one way actions leak
// between otherwise-isolated contexts, and recommend a module per independent
// workload. Sharing one module across the session VM + concurrently-executing
// fork/delegate VMs produced SILENTLY dropped host-bridge calls late in heavy
// runs (a `delegate()` that never registered its yield, `fetch()` resolving
// `undefined` inside webSearch, `currentTask.resolve()` no-oping so live forks
// salvaged despite the model resolving) — see the E2 live-test finding
// (2026-07-02). Instantiation overhead is milliseconds against fork lifetimes
// of seconds, so isolation wins.
function getWASMModule(): Promise<QuickJSAsyncWASMModule> {
  // LM_QJS_DEBUG loads the assertion-tracking debug variant, whose ctx.dispose()
  // THROWS a descriptive "handle not disposed" error (with creation stack) instead
  // of the release variant's fatal `list_empty(&rt->gc_obj_list)` WASM abort — used
  // to pinpoint handle leaks in VM teardown.
  return process.env['LM_QJS_DEBUG']
    ? newQuickJSAsyncWASMModuleFromVariant(DEBUG_ASYNC)
    : newQuickJSAsyncWASMModule();
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

  /** Both the context and its runtime must be live to touch any handle; either being
   *  disposed makes every op throw "Lifetime not alive". */
  function isAlive(): boolean {
    return ctx.alive && runtime.alive;
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
    // A statement can only be evaluated on a live VM. Bail with a structured error
    // rather than throwing the opaque QuickJS "Lifetime not alive" if the VM was
    // disposed out of band (idle reaper / eviction) between turns or mid-resume.
    if (!isAlive()) return { ok: false, error: 'VM disposed mid-turn' };
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
    // Resuming a disposed VM (e.g. after a long yield whose VM was torn down out of band)
    // would throw "Lifetime not alive" from executePendingJobs; return a structured error
    // so the turn loop can end cleanly instead of crashing opaquely. Mirrors getVar's swallow.
    if (!isAlive()) return { ok: false, error: 'VM disposed mid-turn' };
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
    // A disposed ctx makes setProp throw "Lifetime not alive". Keep the host-side scope
    // update (above) but skip the VM write when the VM is gone — the turn loop's own
    // isAlive() guard turns this situation into a clean turn error.
    if (!isAlive()) return;
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
    // Drain any residual promise-reaction jobs so the objects they retain become
    // collectable before we free the context — an undrained job queue is one way a
    // stray object survives into runtime teardown.
    try {
      for (;;) {
        const r = runtime.executePendingJobs();
        if ('error' in r && r.error) { r.error.dispose(); break; }
        if (!('value' in r) || r.value === 0) break;
      }
    } catch {
      /* a job threw mid-drain — nothing we can act on during teardown */
    }
    // ctx.dispose()/runtime.dispose() can hit QuickJS's
    // `list_empty(&rt->gc_obj_list)` assertion when a stray GC object survives teardown
    // (seen under deep fork/delegate nesting with many nested `fetch` yields). That
    // assertion is a CATCHABLE, non-fatal cleanup failure — the shared WASM module stays
    // fully usable afterward (verified) — so swallow it. Letting it propagate would turn
    // an already-produced fork/delegate result into a spurious rejection (see fork.ts),
    // which is exactly the failure it must not cause.
    try {
      ctx.dispose();
    } catch {
      /* stray-object teardown assertion — benign, swallow */
    }
    try {
      runtime.dispose();
    } catch {
      /* stray-object teardown assertion — benign, swallow */
    }
  }

  return { evalStatement, evalScript, drivePendingJobs, getScope, setVar, getVar, isAlive, dispose, pendingYields, ctx };
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

/**
 * Load / invoke **store-downloaded module code** in a worker-isolated runtime.
 *
 * Space emitter defs and space hook handlers are code the pod DID NOT author —
 * they must never be `require()`d in the main process (a top-level side effect
 * would run with the pod's privileges). This helper is the single seam both the
 * emitter scanner (`server/emitter-manifests.ts`, S4) and the space-hook loader
 * (`app/hooks/loader.ts`, S7) use to touch that code safely:
 *
 *   - {@link loadDefaultInWorker} — evaluate a `.ts` module in a worker and
 *     return the default export's serializable DATA (functions stripped) + the
 *     names of its function-valued keys. Used to read a def's shape without ever
 *     holding a store-code closure in-proc.
 *   - {@link invokeDefaultFnInWorker} — evaluate the module in a worker and call
 *     `default.<fnKey>(ctx)`; the ctx's `db`/`delegate`/`callConnection`/
 *     `tasklist.run` are proxies serviced by the caller's main-process
 *     {@link WorkerInvokeHandlers}. Used to run a space hook handler.
 *
 * The `.ts` is transpiled to CJS in the main process (esbuild) and the CODE
 * string is passed to the worker — no `.ts` toolchain in the worker, same as the
 * api runtime. Every call is timeout-bounded (a hostile top-level loop or a hung
 * handler is terminated).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';

import { build, transform } from 'esbuild';

import type { WorkerLoadJob, WorkerLoadToMain, ProxyReplyToWorker } from './worker-load-protocol.js';

/** Default wall-clock budget for one worker load/invoke. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** The db method names proxied to the main process (mirrors `@lmthing/core`'s `AsyncDbApi`). */
const DB_METHODS = ['query', 'tables', 'insert', 'update', 'remove', 'createTable', 'addColumn'];

/** Local structural view of a `node:worker_threads` Worker (the shared tsconfig's
 *  DOM lib defines a colliding global `Worker`; cast to this instead). */
interface WorkerHandle {
  on(event: 'message', listener: (msg: WorkerLoadToMain) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  postMessage(value: ProxyReplyToWorker): void;
  terminate(): Promise<number>;
}

// ── Worker source bundling (once per process) ─────────────────────────────────

let workerSourcePromise: Promise<string> | undefined;

/** Bundle `worker-load-entry.ts` → a self-contained CJS string (cached). */
function workerSource(): Promise<string> {
  if (!workerSourcePromise) {
    const here = dirname(fileURLToPath(import.meta.url));
    const tsEntry = join(here, 'worker-load-entry.ts');
    const jsEntry = join(here, 'worker-load-entry.js');
    const entry = existsSync(tsEntry) ? tsEntry : jsEntry;
    workerSourcePromise = build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      target: 'node18',
    }).then((res) => res.outputFiles[0].text);
  }
  return workerSourcePromise;
}

// ── Transpile (once per file content) ─────────────────────────────────────────

/** Transpile a `.ts` file → CJS. Never evaluates it (that happens in the worker). */
async function transpileFile(file: string): Promise<string> {
  const source = await readFile(file, 'utf8');
  const { code } = await transform(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'node18',
    sourcefile: file,
  });
  return code;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** The default export's serializable shape + the keys that held functions. */
export interface WorkerLoadResult {
  /** Own enumerable data properties of the default export (functions omitted). */
  data: Record<string, unknown>;
  /** Keys of the default export whose value was a function (e.g. `handler`, `emit`). */
  functionKeys: string[];
}

/** Proxy handlers the main process supplies when a worker fn is invoked. Each is
 *  optional — a call to a missing capability rejects in the worker. */
export interface WorkerInvokeHandlers {
  db?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  delegate?: (spaceRef: string, action?: string, opts?: unknown) => Promise<unknown>;
  callConnection?: (provider: string, req?: unknown) => Promise<unknown>;
  tasklistRun?: (ref: string, seed?: unknown) => Promise<unknown>;
  /** Cron-emitter per-def JSON KV scratchpad (`ctx.state.get`/`set`), serviced
   *  main-side by `server/emitter-state.ts`. Omitted for hooks/code nodes (a
   *  `ctx.state` call then rejects). */
  state?: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> };
  /** Typed live-project writers (`writeProjectTable`/`writeProjectApi`/`writeProjectView`/
   *  `writeProjectViewComponent`/…) exposed as `ctx.<name>` proxies so a tasklist CODE node can
   *  author files. Each returns a serializable `{ ok, error? }` (readers return their payload);
   *  synchronous impls are fine — `serviceProxy` awaits the return either way. */
  authoring?: Record<string, (...args: unknown[]) => unknown>;
}

/**
 * Evaluate `file`'s module in a worker and return its default export's
 * serializable data + function-key list. The module is NEVER evaluated in-proc.
 */
export async function loadDefaultInWorker(
  file: string,
  opts: { timeoutMs?: number } = {},
): Promise<WorkerLoadResult> {
  const code = await transpileFile(file);
  const result = await runWorker({ mode: 'load', code }, {}, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (result.type !== 'loaded') {
    throw new Error(`worker-load: unexpected result loading "${file}"`);
  }
  return { data: result.data, functionKeys: result.functionKeys };
}

/**
 * Evaluate `file`'s module in a worker and invoke `default.<fnKey>(ctx)`. The
 * ctx merges `ctxSeed` (serializable fields) with proxy methods serviced by
 * `handlers` in the main process. Returns the fn's serializable result.
 */
export async function invokeDefaultFnInWorker(
  file: string,
  fnKey: string,
  ctxSeed: Record<string, unknown>,
  handlers: WorkerInvokeHandlers,
  opts: { timeoutMs?: number } = {},
): Promise<unknown> {
  const code = await transpileFile(file);
  const job: WorkerLoadJob = {
    mode: 'invoke', code, fnKey, ctxSeed, dbMethods: DB_METHODS,
    authoringMethods: handlers.authoring ? Object.keys(handlers.authoring) : undefined,
  };
  const result = await runWorker(job, handlers, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (result.type === 'result') return result.value;
  throw new Error(`worker-load: unexpected result invoking "${fnKey}" in "${file}"`);
}

/**
 * Evaluate `file`'s module in a worker and invoke a top-level NAMED export
 * `fnName(ctx, ...args)`. Unlike {@link invokeDefaultFnInWorker} (which targets a
 * method on the module's `default` export object), this calls a function exported
 * at module top level and passes extra positional `args` AFTER the proxied ctx —
 * the shape a tasklist code node uses (`export async function run(ctx, inputs)`;
 * no default export). The ctx's `db`/`delegate`/`callConnection` proxies are
 * serviced by `handlers` in the main process, exactly as for the default path.
 * Returns the fn's serializable result.
 */
export async function invokeNamedFnInWorker(
  file: string,
  fnName: string,
  args: unknown[],
  handlers: WorkerInvokeHandlers,
  opts: { timeoutMs?: number } = {},
): Promise<unknown> {
  const code = await transpileFile(file);
  const job: WorkerLoadJob = {
    mode: 'invoke',
    code,
    fnKey: fnName,
    namedFn: fnName,
    extraArgs: args,
    ctxSeed: {},
    dbMethods: DB_METHODS,
    authoringMethods: handlers.authoring ? Object.keys(handlers.authoring) : undefined,
  };
  const result = await runWorker(job, handlers, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (result.type === 'result') return result.value;
  throw new Error(`worker-load: unexpected result invoking "${fnName}" in "${file}"`);
}

// ── Worker lifecycle + proxy servicing ────────────────────────────────────────

/** Launch one worker for `job`, service its proxies against `handlers`, and
 *  resolve with the terminal message (`loaded`/`result`) or reject (`error`,
 *  crash, or timeout). The worker is always torn down. */
function runWorker(
  job: WorkerLoadJob,
  handlers: WorkerInvokeHandlers,
  timeoutMs: number,
): Promise<Extract<WorkerLoadToMain, { type: 'loaded' } | { type: 'result' }>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: WorkerHandle | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void worker?.terminate();
      fn();
    };

    timer = setTimeout(() => {
      settle(() => reject(new Error(`worker-load: timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    timer.unref?.();

    workerSource()
      .then((source) => {
        worker = new NodeWorker(source, { eval: true, workerData: job }) as unknown as WorkerHandle;

        worker.on('message', (msg: WorkerLoadToMain) => {
          if (msg.type === 'proxy') {
            void serviceProxy(worker!, msg, handlers);
          } else if (msg.type === 'loaded' || msg.type === 'result') {
            settle(() => resolve(msg));
          } else if (msg.type === 'error') {
            settle(() => reject(new Error(msg.message)));
          }
        });
        worker.on('error', (err) => settle(() => reject(err)));
        worker.on('exit', (exitCode) => {
          if (settled) return;
          settle(() => reject(new Error(`worker-load: worker exited early (code ${exitCode})`)));
        });
      })
      .catch((err) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))));
  });
}

/** Service one worker proxy request against the caller's main-process handlers. */
async function serviceProxy(
  worker: WorkerHandle,
  msg: Extract<WorkerLoadToMain, { type: 'proxy' }>,
  handlers: WorkerInvokeHandlers,
): Promise<void> {
  try {
    let result: unknown;
    if (msg.kind === 'db') {
      const { method, args } = msg.payload as { method: string; args: unknown[] };
      const fn = handlers.db?.[method];
      if (typeof fn !== 'function') throw new Error(`db.${method} is not available to this hook`);
      result = await fn(...args);
    } else if (msg.kind === 'delegate') {
      if (!handlers.delegate) throw new Error('delegate is not available to this hook');
      const { spaceRef, action, opts } = msg.payload as { spaceRef: string; action?: string; opts?: unknown };
      result = await handlers.delegate(spaceRef, action, opts);
    } else if (msg.kind === 'callConnection') {
      if (!handlers.callConnection) throw new Error('callConnection is not available to this hook');
      const { provider, req } = msg.payload as { provider: string; req?: unknown };
      result = await handlers.callConnection(provider, req);
    } else if (msg.kind === 'state') {
      if (!handlers.state) throw new Error('ctx.state is not available here (cron emitters only)');
      const { op, key, value } = msg.payload as { op: 'get' | 'set'; key: string; value?: unknown };
      if (op === 'get') result = await handlers.state.get(key);
      else result = await handlers.state.set(key, value);
    } else if (msg.kind === 'authoring') {
      const { method, args } = msg.payload as { method: string; args: unknown[] };
      const fn = handlers.authoring?.[method];
      if (typeof fn !== 'function') throw new Error(`ctx.${method} is not available to this code node`);
      result = await fn(...args);
    } else {
      if (!handlers.tasklistRun) throw new Error('tasklist runner not available yet');
      const { ref, seed } = msg.payload as { ref: string; seed?: unknown };
      result = await handlers.tasklistRun(ref, seed);
    }
    worker.postMessage({ type: 'proxyReply', id: msg.id, ok: true, result });
  } catch (err) {
    worker.postMessage({
      type: 'proxyReply',
      id: msg.id,
      ok: false,
      error: { message: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Worker entry for {@link ./worker-load.ts} — the **crash + isolation boundary**
 * for evaluating STORE-DOWNLOADED module code (space emitter defs, space hook
 * handlers) that must NEVER run in the main process.
 *
 * It receives a {@link WorkerLoadJob} via `workerData` and runs in one of two
 * modes:
 *
 *   - `load`   — evaluate the module and post back the default export's
 *                **serializable data** (functions stripped) plus the list of
 *                keys whose value was a function (`handler`/`emit`/…). This lets
 *                the main process learn a def's shape WITHOUT ever holding a
 *                function value that closes over store code.
 *   - `invoke` — evaluate the module and call `default.<fnKey>(ctx)`. `ctx` is
 *                assembled from the serializable `ctxSeed` plus proxy methods
 *                (`db`/`delegate`/`callConnection`/`tasklist.run`) that round-trip
 *                to the main process (keyed by a monotonic id), so the store code
 *                touches capabilities only through the main-process gate — the
 *                same posture as `app/api/worker.ts`.
 *
 * The module CODE is transpiled to CJS in the main process and passed in as a
 * string (no `.ts` toolchain in the worker); it is evaluated in a fresh module
 * scope with a `require` shim, exactly like `app/api/handler-module.ts`.
 *
 * Bundled to a self-contained CJS string by `worker-load.ts` (esbuild) and
 * launched with `new Worker(code, { eval: true, workerData })`, so it runs
 * identically under vitest (source `.ts`) and the built CLI.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import type { WorkerLoadJob, WorkerLoadToMain, ProxyReplyToWorker, ProxyKind } from './worker-load-protocol.js';

// Base a real `require` at the process cwd so an incidental bare import resolves
// against the project's node_modules (mirrors app/api/handler-module.ts).
const realRequire = createRequire(join(process.cwd(), 'lmthing-worker-load.cjs'));

/** Evaluate a CJS module string in a fresh scope; return its `exports`. */
function evalModule(code: string): Record<string, unknown> {
  const shimRequire = (id: string): unknown => realRequire(id);
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', 'require', code);
  fn(moduleObj, moduleObj.exports, shimRequire);
  return moduleObj.exports;
}

/** Split a default export into serializable data + the keys that held functions. */
function splitDefault(def: unknown): { data: Record<string, unknown>; functionKeys: string[] } {
  if (def === null || typeof def !== 'object') {
    return { data: {}, functionKeys: [] };
  }
  const data: Record<string, unknown> = {};
  const functionKeys: string[] = [];
  for (const [k, v] of Object.entries(def as Record<string, unknown>)) {
    if (typeof v === 'function') functionKeys.push(k);
    else data[k] = v;
  }
  return { data, functionKeys };
}

function main(): void {
  const port = parentPort;
  if (!port) throw new Error('worker-load: no parentPort (must run as a worker_thread)');
  const job = workerData as WorkerLoadJob;

  const post = (msg: WorkerLoadToMain): void => port.postMessage(msg);

  // ── Proxy request/reply registry (invoke mode) ────────────────────────────
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  function rpc(kind: ProxyKind, payload: unknown): Promise<unknown> {
    const id = ++seq;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ type: 'proxy', id, kind, payload });
    });
  }
  port.on('message', (msg: ProxyReplyToWorker) => {
    if (msg.type !== 'proxyReply') return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error?.message ?? 'proxy call failed'));
  });

  (async () => {
    const exp = evalModule(job.code);
    const def = exp['default'];

    if (job.mode === 'load') {
      const { data, functionKeys } = splitDefault(def);
      post({ type: 'loaded', data, functionKeys });
      return;
    }

    // invoke — build a proxied ctx and call the target fn.
    //   default.<fnKey>(ctx)          — space hooks/emitters (default export object)
    //   exports.<namedFn>(ctx, ...args) — tasklist code nodes (top-level `run(ctx, inputs)`)
    let fn: unknown;
    if (job.namedFn) {
      fn = exp[job.namedFn];
      if (typeof fn !== 'function') {
        throw new Error(`worker-load: module has no exported function "${job.namedFn}"`);
      }
    } else {
      if (def === null || typeof def !== 'object') {
        throw new Error('worker-load: module default export is not an object');
      }
      fn = (def as Record<string, unknown>)[job.fnKey];
      if (typeof fn !== 'function') {
        throw new Error(`worker-load: default export has no function "${job.fnKey}"`);
      }
    }

    const db: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    for (const method of job.dbMethods) {
      db[method] = (...args: unknown[]) => rpc('db', { method, args });
    }

    const ctx: Record<string, unknown> = {
      ...job.ctxSeed,
      db,
      delegate: (spaceRef: string, action?: string, opts?: unknown) =>
        rpc('delegate', { spaceRef, action, opts }),
      callConnection: (provider: string, req?: unknown) => rpc('callConnection', { provider, req }),
      tasklist: { run: (ref: string, seed?: unknown) => rpc('tasklist', { ref, seed }) },
    };

    const value = await (fn as (c: unknown, ...rest: unknown[]) => unknown)(ctx, ...(job.extraArgs ?? []));
    post({ type: 'result', value });
  })().catch((err: unknown) => {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
}

main();

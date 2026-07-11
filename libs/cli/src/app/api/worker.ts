/**
 * The api-handler **worker entry** (`worker_threads`) — the crash boundary.
 *
 * It receives a {@link WorkerJob} (`{ handlerCode, method, input }`) via
 * `workerData`, loads the transpiled handler with {@link loadHandlerFromCode},
 * builds a `ctx` whose `db` / `spawn` / `apiCall` are **async proxies** (each
 * call posts a {@link ProxyRequestMessage} to `parentPort` and awaits a
 * correlated {@link ProxyReplyMessage}, keyed by a monotonic id), runs
 * `await handler(input, ctx)`, and posts back a {@link ResultMessage} or
 * {@link ErrorMessage}.
 *
 * The worker holds no state and never touches the filesystem/db directly — the
 * proxies are the only path to the main process, so a crashing handler cannot
 * corrupt shared state (it just takes down this thread; the runtime maps the
 * `exit`/`error` to a 500).
 *
 * Bundled to a self-contained CJS string by `runtime.ts` (esbuild) and launched
 * with `new Worker(code, { eval: true, workerData })`, so it runs identically
 * under vitest (source `.ts`) and the built CLI (no separate `.ts` toolchain in
 * the worker).
 */

import { parentPort, workerData } from 'node:worker_threads';

import type { AsyncDbApi, ApiCallFn } from '@lmthing/core';

import { HttpError, serializeHttpError } from './errors.js';
import { loadHandlerFromCode, loadModuleExports } from './handler-module.js';
import type {
  WorkerJob,
  LoadModuleJob,
  ProxyKind,
  ProxyRequestMessage,
  ProxyReplyMessage,
  WorkerToMain,
  SpawnReply,
} from './protocol.js';

/** The worker-side ctx handed to a handler. `spawn` is async here (proxy round-trip). */
interface WorkerCtx {
  db: AsyncDbApi;
  apiCall: ApiCallFn;
  /**
   * Fire-and-forget spawn. Unlike the agent-side sync `SpawnFn`, the worker proxy
   * is async (it round-trips to main). A synchronous runner failure is delivered
   * to `onError` **before** the returned promise resolves; an async-later failure
   * is Phase 6 (handled main-side, never re-enters a finished worker).
   */
  spawn: (
    ref: string,
    input?: unknown,
    opts?: { onError?: (err: unknown) => void | Promise<void> },
  ) => Promise<{ runId: string }>;
}

/** The db method names proxied to the main process (mirrors {@link AsyncDbApi}). */
const DB_METHODS = [
  'query',
  'tables',
  'insert',
  'update',
  'remove',
  'createTable',
  'addColumn',
] as const;

/**
 * The generic **load-module** path (emitter-def scanner, S4). Eval the
 * transpiled module in this isolated thread and post back ONLY the picked DATA
 * fields of its default export — never a function (`postMessage` can't clone
 * one, and `emit` is deliberately not extracted). This thread IS the containment
 * boundary: a hostile def's top-level code (infinite loop, fs probe) dies here,
 * and main-side terminates it on timeout; nothing reaches the pod process.
 */
function runLoadModule(port: NonNullable<typeof parentPort>, job: LoadModuleJob): void {
  try {
    const exp = loadModuleExports(job.code);
    const def = exp['default'];
    const data: Record<string, unknown> = {};
    if (def !== null && typeof def === 'object') {
      for (const key of job.pick) {
        const v = (def as Record<string, unknown>)[key];
        if (v === undefined || typeof v === 'function') continue; // elide functions
        data[key] = v;
      }
    }
    // JSON round-trip → guaranteed structured-cloneable + any stray nested
    // function silently dropped (never a DataCloneError back to main).
    const value = JSON.parse(JSON.stringify(data)) as unknown;
    port.postMessage({ type: 'result', value } satisfies WorkerToMain);
  } catch (err) {
    port.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerToMain);
  }
}

function main(): void {
  const port = parentPort;
  if (!port) throw new Error('api worker: no parentPort (must run as a worker_thread)');
  const raw = workerData as WorkerJob | LoadModuleJob;

  // Generic module-load job (no `ctx`, no proxies) — branch before wiring any.
  if ((raw as LoadModuleJob).loadModule) {
    runLoadModule(port, raw as LoadModuleJob);
    return;
  }
  const job = raw as WorkerJob;

  // ── Proxy request/reply registry ──────────────────────────────────────────
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

  function rpc(kind: ProxyKind, payload: ProxyRequestMessage['payload']): Promise<unknown> {
    const id = ++seq;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const msg: ProxyRequestMessage = { type: 'proxy', id, kind, payload };
      port!.postMessage(msg);
    });
  }

  port.on('message', (msg: ProxyReplyMessage) => {
    if (msg.type !== 'proxyReply') return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error?.message ?? 'proxy call failed'));
  });

  // ── ctx.db — an AsyncDbApi whose every method is a proxy ───────────────────
  const db = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const method of DB_METHODS) {
    db[method] = (...args: unknown[]) => rpc('db', { method, args });
  }

  // ── ctx.apiCall — resolve a named endpoint in the main process ─────────────
  const apiCall: ApiCallFn = (name: string, input?: unknown) =>
    rpc('apiCall', { name, input });

  // ── ctx.spawn — fire-and-forget; synchronous onError folded into the reply ─
  const spawn: WorkerCtx['spawn'] = async (ref, input, opts) => {
    const reply = (await rpc('spawn', { ref, input })) as SpawnReply;
    if (reply.error && opts?.onError) {
      await opts.onError(new Error(reply.error.message));
    }
    return { runId: reply.runId };
  };

  const ctx: WorkerCtx = { db: db as unknown as AsyncDbApi, apiCall, spawn };

  // ── Run the handler ────────────────────────────────────────────────────────
  (async () => {
    const mod = loadHandlerFromCode(job.handlerCode);
    if (typeof mod.handler !== 'function') {
      throw new Error('api worker: handler module has no default export function');
    }
    return await mod.handler(job.input, ctx);
  })().then(
    (value) => {
      const msg: WorkerToMain = { type: 'result', value };
      port.postMessage(msg);
    },
    (err: unknown) => {
      const msg: WorkerToMain =
        err instanceof HttpError
          ? { type: 'error', serialized: serializeHttpError(err) }
          : { type: 'error', message: err instanceof Error ? err.message : String(err) };
      port.postMessage(msg);
    },
  );
}

main();

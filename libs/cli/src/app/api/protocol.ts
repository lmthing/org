/**
 * The worker ↔ main **message protocol** for the api runtime (Phase 3, 3A).
 *
 * An api handler runs in a `worker_threads` Worker (a **crash boundary** — a
 * handler that throws / `process.exit()`s / segfaults takes down the worker, not
 * the pod's main process). The worker holds **no** state: its `ctx.db` /
 * `ctx.spawn` / `ctx.apiCall` are async proxies that post a request here and
 * await a correlated reply, so **every db write executes in the main process**
 * (the crash-boundary invariant — no `Atomics`, no `SharedArrayBuffer`, plain
 * `postMessage` request/reply).
 *
 * These types are shared by `worker.ts` (posts `WorkerToMain`, receives
 * `MainToWorker`) and `runtime.ts` (the mirror). Kept dependency-free so
 * bundling `worker.ts` never drags runtime/main code into the worker.
 */

import type { SerializedHttpError } from './errors.js';

/** The job handed to a freshly-spawned worker (via `workerData`). */
export interface WorkerJob {
  /** The esbuild-transpiled (CJS) source of the handler module. */
  handlerCode: string;
  /** The HTTP method (selects nothing in the worker; carried for diagnostics). */
  method: string;
  /** The fully-assembled `Input` object (path params already merged in, main-side). */
  input: unknown;
}

/**
 * A generic **load-module** job (the emitter-def scanner, S4) — reuses the same
 * crash-isolated worker as an api handler, but along a proxy-less path: the
 * worker `eval`s the transpiled module and posts back ONLY the picked DATA
 * fields of its default export (functions elided). No `ctx`, no db/spawn/apiCall.
 *
 * Store-downloaded emitter defs (`events/*.ts`) MUST be extracted this way — the
 * worker is the crash + timeout boundary, so a hostile def (a top-level infinite
 * loop, an fs probe) is contained in this thread and terminated main-side on
 * timeout, never touching the pod process. The def's `emit` function is
 * deliberately NOT extracted (functions don't survive `postMessage`); later
 * steps re-load the def from its file path to run `emit` inside a worker.
 *
 * The discriminant is the `loadModule: true` marker — a {@link WorkerJob} lacks
 * it, so the worker branches on its presence.
 */
export interface LoadModuleJob {
  loadModule: true;
  /** The esbuild-transpiled (CJS) source of the module to load. */
  code: string;
  /** The default-export field names to serialize back (data only; functions elided). */
  pick: string[];
}

/** Which main-process capability a proxy request targets. */
export type ProxyKind = 'db' | 'spawn' | 'apiCall';

/** A `db.<method>(...args)` proxy request payload. */
export interface DbProxyPayload {
  method: string;
  args: unknown[];
}

/** A `spawn(ref, input)` proxy request payload. */
export interface SpawnProxyPayload {
  ref: string;
  input: unknown;
}

/** An `apiCall(name, input)` proxy request payload. */
export interface ApiCallProxyPayload {
  name: string;
  input: unknown;
}

/** Worker → main: a proxy request awaiting a correlated {@link ProxyReplyMessage}. */
export interface ProxyRequestMessage {
  type: 'proxy';
  /** Monotonic correlation id, unique per worker. */
  id: number;
  kind: ProxyKind;
  payload: DbProxyPayload | SpawnProxyPayload | ApiCallProxyPayload;
}

/** Worker → main: the handler resolved to a value → HTTP 200. */
export interface ResultMessage {
  type: 'result';
  value: unknown;
}

/**
 * Worker → main: the handler threw.
 * - `serialized` present → an {@link HttpError} (that status is returned).
 * - otherwise `message` carries the real error text — logged main-side, **never**
 *   placed in the response body (generic 500).
 */
export interface ErrorMessage {
  type: 'error';
  serialized?: SerializedHttpError;
  message?: string;
}

/** Any message the worker posts to main. */
export type WorkerToMain = ProxyRequestMessage | ResultMessage | ErrorMessage;

/**
 * Main → worker: the reply to a {@link ProxyRequestMessage}.
 *
 * For `spawn`, `result` is `{ runId, error? }` — `error` (a serialized error) is
 * set when the supplied `spawnRunner` invoked `onError` **synchronously** (P3
 * only delivers synchronous-onError; an async-later runner failure is Phase 6,
 * handled main-side, and cannot cross back into a finished worker).
 */
export interface ProxyReplyMessage {
  type: 'proxyReply';
  id: number;
  ok: boolean;
  result?: unknown;
  /** A serialized error (`{ message, ... }`) when `ok` is false. */
  error?: { message: string };
}

/** Any message main posts to the worker. */
export type MainToWorker = ProxyReplyMessage;

/** The shape a `spawn` proxy resolves to inside the worker. */
export interface SpawnReply {
  runId: string;
  /** Set when the runner reported a synchronous failure; carries the error text. */
  error?: { message: string } | null;
}

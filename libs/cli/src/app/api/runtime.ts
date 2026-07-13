/**
 * The **main-process api runtime** (Phase 3, 3A).
 *
 * Matches a request to a file-based endpoint ({@link ./loader.js}), transpiles the
 * handler with esbuild (cached by file mtime), and runs it in a **worker**
 * (`worker_threads`) — a crash boundary. The worker's `db`/`spawn`/`apiCall`
 * proxies post messages that this runtime services against the **main-process**
 * `db` / `spawnRunner` / `apiCallResolver`, so every db write executes here (never
 * in the worker — the worker is a crash boundary, not a data path). A handler that
 * throws / `process.exit()`s / segfaults takes down only its worker; the runtime
 * catches the `error`/`exit` and returns a generic 500 (the real message logged,
 * never leaked).
 *
 * The worker entry (`worker.ts`) is bundled once to a self-contained CJS string
 * (esbuild) and launched with `new Worker(code, { eval: true })`, so it runs
 * identically under vitest (source) and the built CLI (no `.ts` toolchain needed
 * in the worker).
 *
 * ⚠️ Imports the error contract + input assembly from **3B** (`./errors.js`,
 * `./input.js`).
 */

import { Worker as NodeWorker } from 'node:worker_threads';
import { stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

import { build, transform } from 'esbuild';
import type { AsyncDbApi, ApiCallFn } from '@lmthing/core';

import {
  errorResponseFor,
  toErrorBody,
  type ApiErrorBody,
} from './errors.js';
import { assembleInput, passThroughValidator, type HttpMethod, type InputValidator } from './input.js';
import {
  loadApiRoutes,
  matchRoute,
  type Endpoint,
  type RouteTable,
} from './loader.js';
import type { MainToWorker, ProxyRequestMessage, WorkerJob, WorkerToMain } from './protocol.js';

/**
 * The subset of a `node:worker_threads` Worker this runtime uses. Typed locally
 * because the shared tsconfig's DOM lib defines a **global** `Worker` that
 * collides with the node class and shadows its `EventEmitter` `.on` in this
 * program — so we cast the constructed worker to this interface instead.
 */
interface WorkerHandle {
  on(event: 'message', listener: (msg: WorkerToMain) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  postMessage(value: MainToWorker): void;
  terminate(): Promise<number>;
}

/** The result of running an endpoint: an HTTP status + a JSON-able body. */
export interface ApiResponse {
  status: number;
  body: unknown;
}

/**
 * The seam the integrator supplies for `spawn` (fire-and-forget agent runs). The
 * real agent runner is Phase 6; for P3 the integrator passes a minimal impl or a
 * stub. Returns immediately with a `runId`; a **synchronous** failure is reported
 * via `onError` (delivered back into the still-live worker before its `spawn`
 * promise resolves — see `worker.ts`).
 */
export type SpawnRunner = (
  ref: string,
  input: unknown,
  onError?: (err: unknown) => void,
) => { runId: string };

/** Options for {@link createApiRuntime}. */
export interface ApiRuntimeOpts {
  /** The project root (`<root>/<projectId>`) whose `api/` dir is served. */
  projectRoot: string;
  /** The project's **main-process** async db (e.g. `openProjectDb(...).async`). */
  db: AsyncDbApi;
  /** Fire-and-forget agent-run seam (Phase 6 supplies the real runner). */
  spawnRunner: SpawnRunner;
  /**
   * Resolve a named endpoint in-process (the agent-facing `apiCall` path).
   * Optional — defaults to re-entering this runtime's {@link ApiRuntime.callByName}.
   */
  apiCallResolver?: ApiCallFn;
  /** Where to log leaked-internal-error messages (defaults to `console.error`). */
  logError?: (message: string, err?: unknown) => void;
  /** Per-endpoint input validators keyed by endpoint `name` (Phase 4: ajv-compiled from
   *  the generated JSON Schema, `coerceTypes` on). Absent ⇒ the Phase-3 pass-through seam
   *  (no validation). Built once at generation time by `makeValidatorMap`. */
  validators?: Map<string, InputValidator>;
}

/** The api runtime handle. */
export interface ApiRuntime {
  /** Route + run a browser-style request (`method`, `path`, already-parsed `input`). */
  handle(method: string, path: string, input?: unknown): Promise<ApiResponse>;
  /** Route + run by endpoint `name` (the agent-facing `apiCall` path). */
  callByName(name: string, input?: unknown): Promise<ApiResponse>;
  /** The discovered route table (loaded lazily; cached). */
  routes(): Promise<RouteTable>;
  /** Drop caches (routes + transpiled handlers). */
  dispose(): void;
}

// ── Worker source bundling (once per process) ─────────────────────────────────

let workerSourcePromise: Promise<string> | undefined;

/** Bundle `worker.ts` → a self-contained CJS string (cached for the process). */
function workerSource(): Promise<string> {
  if (!workerSourcePromise) {
    const here = dirname(fileURLToPath(import.meta.url));
    const tsEntry = join(here, 'worker.ts');
    const jsEntry = join(here, 'worker.js');
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

/**
 * The bundled (CJS) source of the shared worker entry (`worker.ts`), cached once
 * per process. Exposed so the emitter-def scanner (S4) can run its generic
 * `loadModule` job in the SAME crash-isolated worker (no parallel worker impl).
 */
export function bundledWorkerSource(): Promise<string> {
  return workerSource();
}

// ── Runtime ───────────────────────────────────────────────────────────────────

function isQueryMethod(method: string): boolean {
  return method === 'GET' || method === 'DELETE';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Create the main-process api runtime. See {@link ApiRuntimeOpts}.
 */
export function createApiRuntime(opts: ApiRuntimeOpts): ApiRuntime {
  const { projectRoot, db, spawnRunner } = opts;
  const log = opts.logError ?? ((message: string, err?: unknown) => console.error(message, err ?? ''));

  let routeTable: Promise<RouteTable> | undefined;
  /** Cached per entry file, keyed by the mtimes of EVERY source it bundled in (its deps). */
  const transpileCache = new Map<string, { deps: Map<string, number>; code: string }>();

  function routes(): Promise<RouteTable> {
    if (!routeTable) routeTable = loadApiRoutes(projectRoot);
    return routeTable;
  }

  /** True when every source the cached bundle was built from is still untouched. */
  async function depsUnchanged(deps: Map<string, number>): Promise<boolean> {
    for (const [file, mtimeMs] of deps) {
      const now = await stat(file).then((s) => s.mtimeMs).catch(() => -1);
      if (now !== mtimeMs) return false;
    }
    return true;
  }

  /**
   * BUNDLE a handler `.ts` → CJS, cached by the mtimes of every file that went into it.
   *
   * It bundles rather than merely transpiles because the handler runs from a **code string** in a
   * worker (no file path → no module resolution base): a plain transpile leaves
   * `require('../../functions/calculateGreekVat')` in the output and the worker dies with
   * `Cannot find module`. That is not a corner case — it is the shape the automator is *told* to
   * author ("persist the reusable helper as a project function, have the API use it"), so "put the
   * VAT rule in one function so it can never drift" dead-ended in a 500 and the invoices page
   * rendered "No invoices found" (scenario 07). Project-relative imports are now inlined.
   *
   * `packages: 'external'` keeps bare specifiers (`node:*`, npm deps) as `require()` in the worker,
   * exactly as before. The `project-jail` plugin refuses a relative import that climbs OUT of the
   * project — a handler may compose the project's own code, not read the pod's.
   */
  async function transpile(file: string): Promise<string> {
    const cached = transpileCache.get(file);
    if (cached && (await depsUnchanged(cached.deps))) return cached.code;

    const result = await build({
      entryPoints: [file],
      bundle: true,
      write: false,
      metafile: true,
      format: 'cjs',
      platform: 'node',
      target: 'node18',
      packages: 'external',
      logLevel: 'silent',
      plugins: [
        {
          name: 'project-jail',
          setup(b) {
            b.onResolve({ filter: /^\.\.?\// }, (args) => {
              const abs = resolve(dirname(args.importer), args.path);
              if (abs !== projectRoot && !abs.startsWith(projectRoot + sep)) {
                return { errors: [{ text: `import "${args.path}" escapes the project` }] };
              }
              return undefined; // let esbuild resolve it normally (extension, index, …)
            });
          },
        },
      ],
    });

    const code = result.outputFiles[0]!.text;
    const deps = new Map<string, number>();
    for (const input of Object.keys(result.metafile?.inputs ?? {})) {
      const abs = resolve(process.cwd(), input);
      const m = await stat(abs).then((s) => s.mtimeMs).catch(() => -1);
      deps.set(abs, m);
    }
    if (deps.size === 0) deps.set(file, await stat(file).then((s) => s.mtimeMs).catch(() => -1));
    transpileCache.set(file, { deps, code });
    return code;
  }

  // apiCall resolver — defaults to re-entering callByName (own-project endpoints).
  const apiCallResolver: ApiCallFn =
    opts.apiCallResolver ??
    (async (name: string, input?: unknown) => {
      const res = await callByName(name, input);
      if (res.status >= 400) {
        // Surface the endpoint's error to the caller as a thrown value.
        const body = res.body as ApiErrorBody;
        const err = new Error(body?.error?.message ?? `apiCall("${name}") failed`);
        (err as { status?: number }).status = res.status;
        throw err;
      }
      return res.body;
    });

  /** Assemble the single Input (method-aware) then run the endpoint in a worker. */
  async function runEndpoint(
    endpoint: Endpoint,
    params: Record<string, string>,
    method: string,
    rawInput: unknown,
  ): Promise<ApiResponse> {
    const query = isQueryMethod(method) && isRecord(rawInput) ? rawInput : {};
    const body = isQueryMethod(method) ? undefined : rawInput;
    const assembled = assembleInput(method as HttpMethod, params, query, body);

    const validate = opts.validators?.get(endpoint.name) ?? passThroughValidator;
    const validated = validate(assembled);
    if (!validated.ok) return { status: 400, body: toErrorBody(400, 'invalid input', validated.details) };

    // A handler that cannot be built (a bad import, a syntax error, an import that escapes the
    // project) is a 500 for THAT route — never a rejected promise that takes the request pipeline
    // down with it. The real reason goes to the log, not to the client.
    let code: string;
    try {
      code = await transpile(endpoint.file);
    } catch (err) {
      log(`[api] handler build error: ${endpoint.name}`, err);
      return { status: 500, body: toErrorBody(500, 'internal error') };
    }
    return runWorker(code, method, validated.value);
  }

  /** Spawn a worker for one job, servicing its proxies, and resolve the response. */
  function runWorker(handlerCode: string, method: string, input: unknown): Promise<ApiResponse> {
    return new Promise<ApiResponse>((resolve) => {
      const job: WorkerJob = { handlerCode, method, input };
      let settled = false;
      let worker: WorkerHandle;

      const settle = (res: ApiResponse): void => {
        if (settled) return;
        settled = true;
        resolve(res);
        // Fire-and-forget teardown; the worker is one-shot.
        void worker?.terminate();
      };

      workerSource()
        .then((source) => {
          worker = new NodeWorker(source, { eval: true, workerData: job }) as unknown as WorkerHandle;

          worker.on('message', (msg: WorkerToMain) => {
            if (msg.type === 'proxy') {
              void serviceProxy(worker, msg);
            } else if (msg.type === 'result') {
              settle({ status: 200, body: msg.value });
            } else if (msg.type === 'error') {
              if (msg.serialized) {
                settle(errorResponseFor(msg.serialized));
              } else {
                log(`[api] handler error: ${msg.message ?? 'unknown'}`);
                settle({ status: 500, body: toErrorBody(500, 'internal error') });
              }
            }
          });

          // Worker CRASH isolation — an uncaught throw or a non-zero exit
          // (`process.exit(1)`, segfault) must NOT take down the main process.
          worker.on('error', (err) => {
            log('[api] worker error', err);
            settle({ status: 500, body: toErrorBody(500, 'internal error') });
          });
          worker.on('exit', (exitCode) => {
            if (settled) return;
            log(`[api] worker exited early (code ${exitCode})`);
            settle({ status: 500, body: toErrorBody(500, 'internal error') });
          });
        })
        .catch((err) => {
          log('[api] failed to start worker', err);
          settle({ status: 500, body: toErrorBody(500, 'internal error') });
        });
    });
  }

  /** Service one worker proxy request against the main-process capabilities. */
  async function serviceProxy(worker: WorkerHandle, msg: ProxyRequestMessage): Promise<void> {
    try {
      let result: unknown;
      if (msg.kind === 'db') {
        const { method, args } = msg.payload as { method: string; args: unknown[] };
        const fn = (db as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
        if (typeof fn !== 'function') throw new Error(`db.${method} is not a function`);
        result = await fn(...args);
      } else if (msg.kind === 'apiCall') {
        const { name, input } = msg.payload as { name: string; input: unknown };
        result = await apiCallResolver(name, input);
      } else {
        // spawn — fire-and-forget; capture a SYNCHRONOUS onError to fold into the
        // reply (P3 delivers only synchronous-onError; async-later is Phase 6).
        const { ref, input } = msg.payload as { ref: string; input: unknown };
        let captured: unknown = null;
        const { runId } = spawnRunner(ref, input, (e) => {
          captured = e;
        });
        result = { runId, error: captured ? { message: errMessage(captured) } : null };
      }
      worker.postMessage({ type: 'proxyReply', id: msg.id, ok: true, result });
    } catch (err) {
      worker.postMessage({
        type: 'proxyReply',
        id: msg.id,
        ok: false,
        error: { message: errMessage(err) },
      });
    }
  }

  async function handle(method: string, path: string, input?: unknown): Promise<ApiResponse> {
    const table = await routes();
    const matched = matchRoute(table, method, path);
    if (!matched) return { status: 404, body: toErrorBody(404, 'not found') };
    return runEndpoint(matched.endpoint, matched.params, method, input);
  }

  async function callByName(name: string, input?: unknown): Promise<ApiResponse> {
    const table = await routes();
    const endpoint = table.byName.get(name);
    if (!endpoint) return { status: 404, body: toErrorBody(404, `no endpoint named "${name}"`) };
    return runEndpoint(endpoint, {}, endpoint.method, input);
  }

  return {
    handle,
    callByName,
    routes,
    dispose(): void {
      routeTable = undefined;
      transpileCache.clear();
    },
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

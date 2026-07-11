/**
 * Wire protocol shared by {@link ./worker-load.ts} (main) and
 * {@link ./worker-load-entry.ts} (worker). Kept in its own module (no runtime
 * deps) so the worker entry can be esbuild-bundled without dragging the
 * main-process helper's imports into the worker.
 */

/** Which main-process capability a worker proxy request targets. */
export type ProxyKind = 'db' | 'delegate' | 'callConnection' | 'tasklist';

/** The `workerData` handed to the worker entry. */
export type WorkerLoadJob =
  | { mode: 'load'; code: string }
  | {
      mode: 'invoke';
      code: string;
      /** Which function on the default export to call (e.g. `handler`). */
      fnKey: string;
      /** Serializable ctx fields merged into the invoked fn's ctx (e.g. `row`, `input`, `payload`). */
      ctxSeed: Record<string, unknown>;
      /** The db method names exposed as ctx.db proxies (mirrors `AsyncDbApi`). */
      dbMethods: string[];
    };

/** Worker → main messages. */
export type WorkerLoadToMain =
  | { type: 'loaded'; data: Record<string, unknown>; functionKeys: string[] }
  | { type: 'result'; value: unknown }
  | { type: 'error'; message: string }
  | { type: 'proxy'; id: number; kind: ProxyKind; payload: unknown };

/** Main → worker reply for one proxy request. */
export interface ProxyReplyToWorker {
  type: 'proxyReply';
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}

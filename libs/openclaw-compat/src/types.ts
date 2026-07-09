/**
 * Types for the pod-side OpenClaw-compat host foundation.
 *
 * This package is a **structural shim**, not a reimplementation of OpenClaw.
 * A real OpenClaw plugin's `register(api)` function receives a huge
 * `OpenClawPluginApi` (40+ `register*` methods, plus `api.session`,
 * `api.agent`, `api.lifecycle`, `api.runtime`, ...). We implement a small,
 * de-risking slice of that surface (`registerTool`, `registerHttpRoute`,
 * `registerChannel`, `runtime.subagent.run`, `log`/`logVerbose`) and make
 * everything else throw {@link UnsupportedCompatError} instead of silently
 * doing nothing or crashing with an opaque `TypeError`. See `../COMPAT.md`
 * for the full gap analysis and the plan for closing it.
 */

/** The result of an lmthing agent run, as returned through {@link CompatHost.runAgent}. */
export interface CompatRunAgentResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Options accepted by {@link CompatHost.runAgent} (mirrors `api.runtime.subagent.run`). */
export interface CompatRunAgentOptions {
  sessionKey: string;
  message: string;
  /** Optional agent/provider/model reference; the real binding is host-defined. */
  agentRef?: string;
}

/**
 * The lmthing-supplied seam this package is built against. The pod will
 * implement this later via its `SessionManager.runHeadless` (for `runAgent`)
 * and its HTTP server / Triggers ingress (for `mountRoute`). Kept
 * deliberately minimal — this foundation proves the wiring, not the full
 * feature set.
 */
export interface CompatHost {
  /** Run (or delegate to) an lmthing agent and return its result. */
  runAgent(opts: CompatRunAgentOptions): Promise<CompatRunAgentResult>;
  /** Mount an HTTP route on the pod's server. */
  mountRoute(method: string, path: string, handler: CompatRouteHandler): void;
  /** Structured logging sink — the compat layer routes all plugin log calls here. */
  log(msg: string): void;
}

/** A normalized inbound HTTP request, as passed to a {@link CompatRouteHandler}. */
export interface CompatHttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query?: Record<string, string | string[] | undefined>;
}

/** A normalized HTTP response, as returned by a {@link CompatRouteHandler}. */
export interface CompatHttpResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** The handler shape a plugin passes to `api.registerHttpRoute({ handler })`. */
export type CompatRouteHandler = (
  req: CompatHttpRequest,
) => CompatHttpResponse | Promise<CompatHttpResponse>;

/** A single content block of a tool result (OpenClaw's `{ content: [...] }` shape). */
export interface RegisteredToolResultContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** A tool call result, as returned by a registered tool's `execute`. */
export interface RegisteredToolResult {
  content: RegisteredToolResultContent[];
  [key: string]: unknown;
}

/** A registered tool's `execute` function: `(toolCallId, params) => result`. */
export type RegisteredToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
) => RegisteredToolResult | Promise<RegisteredToolResult>;

/** A tool registered via `api.registerTool(...)`, as recorded in the {@link PluginRegistry}. */
export interface RegisteredTool {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: RegisteredToolExecute;
}

/** An HTTP route registered via `api.registerHttpRoute(...)`. */
export interface RegisteredHttpRoute {
  method: string;
  path: string;
  handler: CompatRouteHandler;
}

/**
 * A channel registered via `api.registerChannel(...)`. This foundation only
 * *records* the registration (and extracts an inbound/send pair when the
 * shape is recognizable) — actual channel routing (webhook binding, Socket
 * Mode, etc.) is a later increment. See `../COMPAT.md`.
 */
export interface RegisteredChannel {
  id?: string;
  name?: string;
  /** The original registration object/argument, kept verbatim for later increments. */
  raw: Record<string, unknown>;
  inbound?: (...args: unknown[]) => unknown;
  send?: (...args: unknown[]) => unknown;
}

/**
 * A provider registered via one of the record-only `register*Provider`
 * methods (`registerWebSearchProvider`, `registerProvider`,
 * `registerEmbeddingProvider`, `registerWebFetchProvider`). This foundation
 * only *records* the registration — it does not wire the provider into any
 * lmthing model/search/embedding pipeline (see `../COMPAT.md`).
 */
export interface RegisteredProvider {
  /** Which `register*Provider` method recorded this. */
  kind: 'webSearch' | 'model' | 'embedding' | 'webFetch';
  /** The provider object/descriptor passed to the register call, kept verbatim. */
  provider: unknown;
}

/**
 * Thrown by any part of the compat surface that a real OpenClaw plugin might
 * call but that this package does not (yet) implement. Fail loud, never
 * silently no-op.
 */
export class UnsupportedCompatError extends Error {
  constructor(what: string) {
    super(`unsupported in @lmthing/openclaw-compat: ${what}`);
    this.name = 'UnsupportedCompatError';
  }
}

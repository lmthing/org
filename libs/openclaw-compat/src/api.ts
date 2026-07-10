/**
 * `createCompatApi` builds the `api` object a plugin's `register(api)` runs
 * against. It implements a small, de-risking slice of the real
 * `OpenClawPluginApi` and makes everything else throw
 * {@link UnsupportedCompatError} — never a silent no-op, never an opaque
 * `TypeError`.
 *
 * Loosely typed on purpose: `OpenClawPluginApiLike = Record<string, unknown>`.
 * The point of this file is a *structural* shim, not a full re-typing of
 * OpenClaw's ~2900-line `OpenClawPluginApi` interface.
 */

import { PluginRegistry } from './registry.js';
import {
  UnsupportedCompatError,
  type CompatHost,
  type CompatRouteHandler,
  type RegisteredChannel,
  type RegisteredProvider,
  type RegisteredToolExecute,
} from './types.js';

/** Loose structural type for the api object handed to a plugin's `register(api)`. */
export type OpenClawPluginApiLike = Record<string, unknown>;

/** Property names implemented directly on the top-level `api` object (not proxied to "unsupported"). */
const IMPLEMENTED_TOP_LEVEL = new Set([
  'registerTool',
  'registerHttpRoute',
  'registerChannel',
  'registerWebSearchProvider',
  'registerProvider',
  'registerEmbeddingProvider',
  'registerWebFetchProvider',
  'runtime',
  'log',
  'logVerbose',
  // Win #1 — broaden loadability: a `logger` namespace (a very common call
  // sequence — `api.logger.info(...)` — that would otherwise throw) and a
  // read-only `pluginConfig`/`config` surface so config-reading route plugins
  // (e.g. OpenClaw's own `webhooks` extension) load instead of throwing.
  'logger',
  'pluginConfig',
  'config',
]);

interface RegisterToolObjectInput {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: RegisteredToolExecute;
}

/**
 * OpenClaw's `registerTool` also accepts a *factory* form:
 * `registerTool((ctx) => toolObject, { name })` — the tool object is built
 * lazily from a per-registration `ctx` (Tavily's `index.ts` uses this: e.g.
 * `api.registerTool((ctx) => createTavilySearchTool(api, ctx), { name:
 * "tavily_search" })`). The object-form input above is still accepted
 * unchanged.
 */
type RegisterToolFactory = (ctx: Record<string, unknown>) => RegisterToolObjectInput;

interface RegisterToolFactoryOpts {
  name?: string;
}

interface RegisterHttpRouteInput {
  /** Optional — OpenClaw's route shape omits it; defaults to `POST`. */
  method?: string;
  path: string;
  handler: CompatRouteHandler;
}

/**
 * Build a `path`-labelled proxy that throws {@link UnsupportedCompatError} on
 * call, and on property access returns a further nested throwing proxy — so
 * both `api.session()` and `api.session.getUser()` fail loud with a path
 * that names exactly what was touched.
 */
function makeUnsupportedProxy(path: string): unknown {
  const target = function unsupported(): never {
    throw new UnsupportedCompatError(`${path} is not implemented in @lmthing/openclaw-compat`);
  };
  return new Proxy(target, {
    apply(): never {
      throw new UnsupportedCompatError(`${path} is not implemented in @lmthing/openclaw-compat`);
    },
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      // Don't let `await`/thenable-probing treat this as a promise.
      if (prop === 'then') return undefined;
      return makeUnsupportedProxy(`${path}.${prop}`);
    },
  });
}

/** Build `api.runtime` — implements only `subagent.run`; everything else under it fails loud. */
function buildRuntimeNamespace(host: CompatHost): unknown {
  const subagentRun = async (opts: {
    sessionKey: string;
    message: string;
    provider?: string;
    model?: string;
  }) => {
    if (!opts || typeof opts.sessionKey !== 'string' || typeof opts.message !== 'string') {
      throw new Error('[openclaw-compat] runtime.subagent.run requires { sessionKey, message }');
    }
    return host.runAgent({
      sessionKey: opts.sessionKey,
      message: opts.message,
      agentRef: opts.provider ?? opts.model,
    });
  };

  const subagent = new Proxy(
    { run: subagentRun },
    {
      get(target, prop) {
        if (prop === 'run') return target.run;
        if (typeof prop !== 'string') return undefined;
        return makeUnsupportedProxy(`api.runtime.subagent.${prop}`);
      },
    },
  );

  return new Proxy(
    { subagent },
    {
      get(target, prop) {
        if (prop === 'subagent') return target.subagent;
        if (typeof prop !== 'string') return undefined;
        return makeUnsupportedProxy(`api.runtime.${prop}`);
      },
    },
  );
}

/**
 * Win #2 — expose a search/fetch provider as an agent-callable tool.
 *
 * OpenClaw's web-search / web-fetch providers carry a `createTool(ctx)` factory
 * whose result is a normal tool object `{ name?, description?, parameters?,
 * execute }` — the SAME shape `registerTool`'s factory form yields (see Brave's
 * `createBraveWebSearchProvider()` → `{ id, createTool }`). So a recorded
 * provider can ALSO be surfaced as a tool the agent reaches through the `tool()`
 * global, with no lmthing-side search-pipeline change. Best-effort: a provider
 * with no `createTool`, a throwing factory, a bad tool shape, or a name that
 * collides with an already-registered tool is skipped (logged) — never fails
 * the provider registration.
 */
function exposeProviderAsTool(
  registry: PluginRegistry,
  host: CompatHost,
  kind: RegisteredProvider['kind'],
  provider: Record<string, unknown>,
): void {
  if (kind !== 'webSearch' && kind !== 'webFetch') return;
  const createTool = provider['createTool'];
  if (typeof createTool !== 'function') return;
  try {
    // OpenClaw's search-provider `createTool` reads `ctx.searchConfig`; pass a
    // minimal ctx (same posture as `registerTool`'s factory form, which passes `{}`).
    const built = (createTool as (ctx: Record<string, unknown>) => unknown)({ searchConfig: {} });
    if (!built || typeof built !== 'object') return;
    const t = built as Record<string, unknown>;
    if (typeof t['execute'] !== 'function') return;
    const providerId = typeof provider['id'] === 'string' ? (provider['id'] as string) : undefined;
    const name =
      (typeof t['name'] === 'string' && t['name']) ||
      (providerId ? `${providerId}_${kind === 'webSearch' ? 'search' : 'fetch'}` : undefined);
    if (!name) return;
    if (registry.getTool(name)) {
      host.log(`[openclaw-compat] provider tool "${name}" already registered — skipping duplicate`);
      return;
    }
    const providerExecute = t['execute'] as (args: unknown) => unknown;
    registry.addTool({
      name,
      description: typeof t['description'] === 'string' ? (t['description'] as string) : undefined,
      parameters: t['parameters'] ?? t['inputSchema'],
      // OpenClaw provider tools take a single `args` object; adapt to the host
      // resolver's `(toolCallId, params)` signature by forwarding `params`.
      execute: (_toolCallId, params) => providerExecute(params) as never,
    });
    host.log(`[openclaw-compat] exposed ${kind} provider "${providerId ?? '(unnamed)'}" as tool "${name}"`);
  } catch (err) {
    host.log(`[openclaw-compat] could not expose ${kind} provider as a tool: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Record a `register*Provider(...)` call into the registry (never throws — see COMPAT.md). */
function recordProvider(
  registry: PluginRegistry,
  host: CompatHost,
  kind: RegisteredProvider['kind'],
  provider: unknown,
): RegisteredProvider {
  if (!provider || (typeof provider !== 'object' && typeof provider !== 'function')) {
    throw new Error(`[openclaw-compat] register${kind[0]!.toUpperCase()}${kind.slice(1)}Provider requires a provider object`);
  }
  const registered: RegisteredProvider = { kind, provider };
  registry.addProvider(registered);
  const id = (provider as Record<string, unknown>).id;
  host.log(
    `[openclaw-compat] registered ${kind} provider "${typeof id === 'string' ? id : '(unnamed)'}" ` +
      '(recorded; search/fetch providers are also exposed as tools — see COMPAT.md)',
  );
  exposeProviderAsTool(registry, host, kind, provider as Record<string, unknown>);
  return registered;
}

/** Build `api.logger` — every level maps to the host's single `log` sink. A
 *  namespace real plugins call constantly (`api.logger.info(...)`); without it
 *  the compat proxy would throw on first use and drop the plugin. */
function buildLogger(host: CompatHost): Record<string, (...args: unknown[]) => void> {
  const level = (name: string) => (...args: unknown[]) =>
    host.log(`[${name}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
  return { info: level('info'), warn: level('warn'), error: level('error'), debug: level('debug'), trace: level('trace'), log: level('log') };
}

/** Options for {@link createCompatApi} — the read-only config surface a plugin
 *  sees via `api.pluginConfig` / `api.config`. Both default to `{}` so a
 *  config-reading plugin loads (and typically registers nothing) rather than
 *  throwing; a host that has per-plugin config can supply it here. */
export interface CreateCompatApiOptions {
  pluginConfig?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

/**
 * Create the compat `api` object for one plugin `register(api)` call.
 * `host` is the pod-side seam; `registry` collects everything the plugin
 * registers; `opts` supplies the read-only `pluginConfig`/`config` surface.
 */
export function createCompatApi(
  host: CompatHost,
  registry: PluginRegistry,
  opts?: CreateCompatApiOptions,
): OpenClawPluginApiLike {
  const implemented: Record<string, unknown> = {
    registerTool(toolOrFactory: RegisterToolObjectInput | RegisterToolFactory, opts?: RegisterToolFactoryOpts) {
      const tool: RegisterToolObjectInput =
        typeof toolOrFactory === 'function'
          ? toolOrFactory({ /* minimal per-registration ctx; real OpenClaw's ctx surface is out of scope here */ })
          : toolOrFactory;

      if (!tool || typeof tool.execute !== 'function') {
        throw new Error('[openclaw-compat] registerTool requires a tool with an execute() function');
      }
      const name = (typeof toolOrFactory === 'function' ? opts?.name : undefined) ?? tool.name;
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('[openclaw-compat] registerTool requires a tool name (via { name } or opts.name)');
      }

      registry.addTool({
        name,
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.execute,
      });
      host.log(`[openclaw-compat] registered tool "${name}"`);
      return { name };
    },

    registerHttpRoute(route: RegisterHttpRouteInput) {
      if (!route || typeof route.path !== 'string' || typeof route.handler !== 'function') {
        throw new Error('[openclaw-compat] registerHttpRoute requires { path, handler }');
      }
      // Win #1 — OpenClaw's route shape omits `method` (it uses `match`/`auth`
      // and defaults to accepting POST webhooks); default to POST when absent
      // instead of rejecting, so those route plugins mount instead of throwing.
      const method = typeof route.method === 'string' ? route.method.toUpperCase() : 'POST';
      registry.addHttpRoute({ method, path: route.path, handler: route.handler });
      host.mountRoute(method, route.path, route.handler);
      host.log(`[openclaw-compat] mounted HTTP route ${method} ${route.path}`);
      return { method, path: route.path };
    },

    registerChannel(registration: Record<string, unknown>) {
      if (!registration || typeof registration !== 'object') {
        throw new Error('[openclaw-compat] registerChannel requires a registration object');
      }
      const inbound =
        typeof registration.onMessage === 'function'
          ? (registration.onMessage as (...args: unknown[]) => unknown)
          : typeof registration.handleInbound === 'function'
            ? (registration.handleInbound as (...args: unknown[]) => unknown)
            : typeof registration.inbound === 'function'
              ? (registration.inbound as (...args: unknown[]) => unknown)
              : undefined;
      const send =
        typeof registration.send === 'function' ? (registration.send as (...args: unknown[]) => unknown) : undefined;
      const channel: RegisteredChannel = {
        id: typeof registration.id === 'string' ? registration.id : undefined,
        name: typeof registration.name === 'string' ? registration.name : undefined,
        raw: registration,
        inbound,
        send,
      };
      registry.addChannel(channel);
      host.log(
        `[openclaw-compat] registered channel "${channel.id ?? channel.name ?? '(unnamed)'}" ` +
          '(recorded only — channel routing is not implemented in this foundation, see COMPAT.md)',
      );
      return channel;
    },

    // Record-only provider registrations. A real host would wire these into
    // lmthing's model/search/embedding/fetch pipelines; this foundation only
    // records them into the registry so a plugin's `register(api)` call
    // sequence can run to completion without throwing (proven against
    // Tavily's real `register`, which calls `registerWebSearchProvider`).
    registerWebSearchProvider(provider: unknown) {
      return recordProvider(registry, host, 'webSearch', provider);
    },
    registerProvider(provider: unknown) {
      return recordProvider(registry, host, 'model', provider);
    },
    registerEmbeddingProvider(provider: unknown) {
      return recordProvider(registry, host, 'embedding', provider);
    },
    registerWebFetchProvider(provider: unknown) {
      return recordProvider(registry, host, 'webFetch', provider);
    },

    runtime: buildRuntimeNamespace(host),

    log(msg: unknown) {
      host.log(String(msg));
    },

    logVerbose(msg: unknown) {
      host.log(String(msg));
    },

    // Win #1 — a `logger` namespace + a read-only config surface. `pluginConfig`
    // / `config` default to `{}` so a plugin that reads config to decide what to
    // register (OpenClaw's `webhooks` early-returns when it finds no routes)
    // loads cleanly instead of hitting a throwing proxy.
    logger: buildLogger(host),
    pluginConfig: opts?.pluginConfig ?? {},
    config: opts?.config ?? {},
  };

  return new Proxy(implemented, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (IMPLEMENTED_TOP_LEVEL.has(prop)) return Reflect.get(target, prop, receiver);
      return makeUnsupportedProxy(`api.${prop}`);
    },
  }) as OpenClawPluginApiLike;
}

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
  type RegisteredToolExecute,
} from './types.js';

/** Loose structural type for the api object handed to a plugin's `register(api)`. */
export type OpenClawPluginApiLike = Record<string, unknown>;

/** Property names implemented directly on the top-level `api` object (not proxied to "unsupported"). */
const IMPLEMENTED_TOP_LEVEL = new Set([
  'registerTool',
  'registerHttpRoute',
  'registerChannel',
  'runtime',
  'log',
  'logVerbose',
]);

interface RegisterToolInput {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: RegisteredToolExecute;
}

interface RegisterHttpRouteInput {
  method: string;
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
 * Create the compat `api` object for one plugin `register(api)` call.
 * `host` is the pod-side seam; `registry` collects everything the plugin
 * registers.
 */
export function createCompatApi(host: CompatHost, registry: PluginRegistry): OpenClawPluginApiLike {
  const implemented: Record<string, unknown> = {
    registerTool(tool: RegisterToolInput) {
      if (!tool || typeof tool.name !== 'string' || typeof tool.execute !== 'function') {
        throw new Error('[openclaw-compat] registerTool requires { name, execute }');
      }
      registry.addTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.execute,
      });
      host.log(`[openclaw-compat] registered tool "${tool.name}"`);
      return { name: tool.name };
    },

    registerHttpRoute(route: RegisterHttpRouteInput) {
      if (
        !route ||
        typeof route.method !== 'string' ||
        typeof route.path !== 'string' ||
        typeof route.handler !== 'function'
      ) {
        throw new Error('[openclaw-compat] registerHttpRoute requires { method, path, handler }');
      }
      const method = route.method.toUpperCase();
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

    runtime: buildRuntimeNamespace(host),

    log(msg: unknown) {
      host.log(String(msg));
    },

    logVerbose(msg: unknown) {
      host.log(String(msg));
    },
  };

  return new Proxy(implemented, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (IMPLEMENTED_TOP_LEVEL.has(prop)) return Reflect.get(target, prop, receiver);
      return makeUnsupportedProxy(`api.${prop}`);
    },
  }) as OpenClawPluginApiLike;
}

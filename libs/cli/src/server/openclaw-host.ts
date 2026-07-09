/**
 * Compute-pod `CompatHost` for `@lmthing/openclaw-compat` — the seam that lets
 * a loaded OpenClaw plugin's `runtime.subagent.run(...)` calls route into a
 * REAL lmthing agent (`SessionManager.runHeadlessThreaded`) and its
 * `registerHttpRoute(...)` calls become reachable through the existing
 * Triggers inbound ingress (`routes/webhooks.ts`'s `POST /api/inbound/:path`
 * dispatcher — see {@link createInboundHandler}'s `pluginRoutes` fallback).
 *
 * Scope: HTTP routes + `runAgent` only. A plugin's `registerTool(...)` calls
 * ARE recorded into the `PluginRegistry` returned by {@link loadOpenClawPlugins}
 * (the compat api records them regardless), but this increment does not wire
 * those tools into any lmthing agent's own tool surface (no
 * `.openclaw-plugins`-sourced tool exposure yet) — that is a later increment.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { createCompatApi, loadPlugin, PluginRegistry } from '@lmthing/openclaw-compat';
import type { CompatHost, CompatRouteHandler } from '@lmthing/openclaw-compat';

/** Minimal manager surface this host needs (satisfied structurally by
 *  `SessionManager`, kept structural to avoid a cross-import — mirrors
 *  `routes/webhooks.ts`'s `InboundManager`). */
export interface ComputeCompatManager {
  runHeadlessThreaded(args: {
    sessionId: string;
    projectId: string;
    spaceRef: string;
    agentSlug: string;
    message: string;
  }): Promise<{ ok: boolean; result?: unknown; error?: string; sessionId: string }>;
}

/** Where a loaded plugin's `runtime.subagent.run(...)` calls are routed — a
 *  real lmthing `space/agent`. `spaceRef` may be `''` to mean "no space
 *  override" (the project root itself, same convention `runHeadless`/
 *  `runHeadlessThreaded` already use when `spaceRef` is falsy). */
export interface ComputeCompatOptions {
  projectId: string;
  spaceRef: string;
  agentSlug: string;
}

/** One HTTP route a plugin mounted via `api.registerHttpRoute(...)`, keyed by
 *  its normalized (leading-`/`-stripped) path so it matches the inbound
 *  dispatcher's `:path` route param directly. */
export interface OpenClawRouteEntry {
  method: string;
  handler: CompatRouteHandler;
}

/** The shared route table a compute host's `mountRoute` writes into, and that
 *  `routes/webhooks.ts`'s `createInboundHandler` reads from as its fallback
 *  when no webhook-hook/space-trigger binding matches `:path`. */
export type OpenClawRouteTable = Map<string, OpenClawRouteEntry>;

/** A `CompatHost` that also exposes the shared route table it writes into, so
 *  {@link loadOpenClawPlugins} can hand it back to its caller after loading
 *  every plugin (the host is the only thing that closes over the table). */
export interface ComputeCompatHost extends CompatHost {
  readonly routeTable: OpenClawRouteTable;
}

/** Strip a leading `/` so a plugin route `/echo` is keyed `echo` — the same
 *  shape the inbound dispatcher's `:path` param arrives in. */
function normalizePath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

/**
 * Derive a stable, RFC-4122-*shaped* uuid from an arbitrary string key, so
 * the SAME `sessionKey` a plugin passes to `runtime.subagent.run(...)` always
 * maps to the SAME `sessionId` — needed so repeated calls resume the SAME
 * persisted `runHeadlessThreaded` session instead of minting a fresh one each
 * time (mirrors why `webhook-threads.ts` keys a persisted sessionId by
 * `<path>::<threadKey>`, except here the mapping is a pure function of the
 * key instead of a persisted lookup table, since there is no separate
 * on-disk store for plugin session keys).
 *
 * NOT a byte-exact RFC 4122 v5 UUID (no namespace UUID mixed into the hash)
 * — just a sha1-derived hex string with the version/variant nibbles stamped
 * per §4.1.3/§4.1.1 and canonical 8-4-4-4-12 dashes, which is sufficient for
 * a deterministic, collision-resistant, filesystem-safe directory name.
 */
export function deterministicUuidFromKey(key: string): string {
  const hex = createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5'; // version 5
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16); // variant 10xx
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20, 32)}`;
}

/**
 * Build the `CompatHost` a compute pod hands to `createCompatApi(...)` for
 * every loaded OpenClaw plugin. `runAgent` derives a stable `sessionId` from
 * `sessionKey` (see {@link deterministicUuidFromKey}) and continues a
 * persisted session via `manager.runHeadlessThreaded` (so a plugin's repeated
 * calls on the same `sessionKey` build one continuous conversation, not a
 * fresh one-shot each time). `mountRoute` writes into the shared
 * `routeTable` the caller owns (also passed to `createInboundHandler` so the
 * Triggers ingress can dispatch to it — see `routes/webhooks.ts`).
 */
export function createComputeCompatHost(
  manager: ComputeCompatManager,
  opts: ComputeCompatOptions,
  routeTable: OpenClawRouteTable,
): ComputeCompatHost {
  return {
    routeTable,
    async runAgent({ sessionKey, message }) {
      try {
        const out = await manager.runHeadlessThreaded({
          sessionId: deterministicUuidFromKey(sessionKey),
          projectId: opts.projectId,
          spaceRef: opts.spaceRef,
          agentSlug: opts.agentSlug,
          message,
        });
        return { ok: out.ok, result: out.result, error: out.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    mountRoute(method, path, handler) {
      routeTable.set(normalizePath(path), { method: method.toUpperCase(), handler });
    },
    log(msg) {
      console.log(`[openclaw] ${msg}`);
    },
  };
}

/**
 * Load every OpenClaw plugin under `pluginsDir` (one subdir per plugin, each
 * with its own `package.json` + `openclaw.plugin.json` — see
 * `@lmthing/openclaw-compat`'s `loadPlugin`) into ONE shared
 * {@link PluginRegistry}, routing every plugin's `registerHttpRoute(...)`
 * call into `host`'s shared `routeTable` (mounted routes are visible there
 * the instant `register(api)` calls `mountRoute`, so the caller doesn't need
 * to wait for this to resolve before wiring the inbound dispatcher — but
 * awaiting it first is still the simplest/safest boot order).
 *
 * No-op (empty registry, `host.routeTable` returned as-is) when `pluginsDir`
 * doesn't exist — existing pods with no `.openclaw-plugins/` directory are
 * completely unaffected. Each plugin directory is loaded best-effort: a
 * failure (bad manifest, throwing `register()`, an `UnsupportedCompatError`
 * for an unimplemented api surface, ...) is logged and skipped so one broken
 * plugin never blocks the others or pod boot.
 */
export async function loadOpenClawPlugins(
  pluginsDir: string,
  host: ComputeCompatHost,
  log: (msg: string) => void,
): Promise<{ registry: PluginRegistry; routeTable: OpenClawRouteTable }> {
  const registry = new PluginRegistry();

  if (!existsSync(pluginsDir)) {
    return { registry, routeTable: host.routeTable };
  }

  let entries: string[];
  try {
    entries = (await readdir(pluginsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    log(`[openclaw] failed to list plugins dir "${pluginsDir}": ${err instanceof Error ? err.message : String(err)}`);
    return { registry, routeTable: host.routeTable };
  }

  for (const name of entries) {
    const dir = join(pluginsDir, name);
    if (!existsSync(join(dir, 'package.json')) || !existsSync(join(dir, 'openclaw.plugin.json'))) continue;

    try {
      const api = createCompatApi(host, registry);
      const { id } = await loadPlugin(dir, api);
      log(`[openclaw] loaded plugin "${id}" from ${dir}`);
    } catch (err) {
      log(`[openclaw] failed to load plugin at "${dir}": ${err instanceof Error ? err.message : String(err)}`);
      // best-effort — one broken plugin must not block the others or pod boot.
    }
  }

  return { registry, routeTable: host.routeTable };
}

/** Parse `LM_OPENCLAW_AGENT` (`space/agent`, e.g. `billing/handler`) into the
 *  `spaceRef`/`agentSlug` pieces {@link ComputeCompatOptions} wants, mirroring
 *  `routes/webhooks.ts`'s `parseTrigger` convention (`spaceRef` = the ref as
 *  given, `agentSlug` = its last path segment). Falls back to `{ spaceRef:
 *  '', agentSlug: 'thing' }` — the SAME "no space override, top-level THING
 *  agent" default `SessionManager.createSession`/`runHeadless` already use
 *  when no `spaceRef`/`agentSlug` is given — when the env var is unset. */
export function parseOpenClawAgentEnv(value: string | undefined): { spaceRef: string; agentSlug: string } {
  if (!value) return { spaceRef: '', agentSlug: 'thing' };
  const spaceRef = value;
  const agentSlug = spaceRef.split('/').filter(Boolean).pop() ?? spaceRef;
  return { spaceRef, agentSlug };
}

/**
 * Phase 1+2+4a (pod side) — inbound-webhook dispatcher.
 *
 * ONE endpoint, `POST /api/inbound/:path`, that an external caller (or the
 * gateway, relaying on the pod's behalf) hits to fire a project's `webhook`
 * hook (`../../app/hooks/loader.ts`'s `WebhookHookDef`). Resolves `:path` to
 * its owning project + `trigger` via `resolveBinding` (`../webhook-manifest.js`),
 * then hands off to the provider adapter (`../webhook-verifiers.js` — Phase
 * 4a) for signature verification, an optional setup preflight, thread-key
 * extraction, and message rendering. Dispatches a one-shot ephemeral run via
 * `manager.runHeadless` (Phase 1 — the SAME agent-run seam `routes/hooks.ts`
 * uses for cron/database hooks) when the event carries no thread key, or a
 * persisted multi-turn run via `manager.runHeadlessThreaded` (Phase 2 —
 * `../webhook-threads.js`'s `getOrCreateThreadSession` maps the external
 * thread key to a stable `sessionId`) when it does.
 *
 * Typed structurally (see {@link InboundManager}), mirroring `routes/hooks.ts`'s
 * `HookManager` — decoupled from the concrete `SessionManager` type.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { readBody, sendJson } from './utils.js';
import { resolveBinding } from '../webhook-manifest.js';
import { getOrCreateThreadSession } from '../webhook-threads.js';
import { getAdapter, resolveWebhookSecret } from '../webhook-verifiers.js';
import type { OpenClawRouteTable } from '../openclaw-host.js';
import type { CompatHttpRequest } from '@lmthing/openclaw-compat';

/** Host-enforced budget forwarded verbatim to `runHeadless` (same shape as
 *  `routes/hooks.ts`'s `HookBudget`, kept structural to avoid a cross-import). */
export interface InboundBudget {
  maxEpisodes?: number;
  maxToolCalls?: number;
  maxForkDepth?: number;
  maxWallClockMs?: number;
}

/** Minimal manager surface this route needs (satisfied structurally by
 *  `SessionManager`, which already has both methods). */
export interface InboundManager {
  runHeadless(args: {
    projectId: string;
    spaceRef: string;
    agentSlug: string;
    message: string;
    budget?: InboundBudget;
  }): Promise<unknown>;
  /** Phase 2 (threading): like `runHeadless`, but continues a persisted
   *  multi-turn session bound to `sessionId` (resume if a snapshot already
   *  exists there, else start fresh) instead of a one-shot ephemeral run. */
  runHeadlessThreaded(args: {
    sessionId: string;
    projectId: string;
    spaceRef: string;
    agentSlug: string;
    message: string;
    budget?: InboundBudget;
  }): Promise<unknown>;
  listProjects(): Promise<Array<{ id: string }>>;
}

/** Parse `space/agent#action` → the pieces `runHeadless` wants (copy of
 *  `routes/hooks.ts`'s `parseTrigger` — kept local so this route has no
 *  compile-time dependency on that module). */
function parseTrigger(trigger: string): { spaceRef: string; agentSlug: string; action: string } {
  const hash = trigger.indexOf('#');
  const spaceRef = hash >= 0 ? trigger.slice(0, hash) : trigger;
  const action = hash >= 0 ? trigger.slice(hash + 1) : '';
  const agentSlug = spaceRef.split('/').pop() ?? spaceRef;
  return { spaceRef, agentSlug, action };
}

/**
 * Handler for `POST /api/inbound/:path` — resolves `:path` to its owning
 * project + `trigger` (via {@link resolveBinding}), looks up the provider
 * adapter (`../webhook-verifiers.js`'s {@link getAdapter}) for
 * `binding.provider`, verifies the request's authenticity, answers a setup
 * preflight if the provider defines one (e.g. Slack's `url_verification`),
 * then renders the raw body into an agent message and dispatches it. Events
 * carrying a thread key (Phase 2 — `adapter.extractThread`) continue ONE
 * persisted multi-turn session per thread via `manager.runHeadlessThreaded`;
 * events with no thread key keep the stateless one-shot `runHeadless` path.
 * Returns the result verbatim (`{ ok, result, error, sessionId }`).
 *
 * Ordering: verify BEFORE preflight. A setup handshake request (e.g. Slack's
 * `url_verification`) is itself a signed request, so verifying first rejects
 * a forged handshake the same as any other forged event, and a legitimate
 * handshake still passes through to `preflight` right after. This keeps ONE
 * verification gate ahead of every different kind of response instead of
 * special-casing preflight as pre-auth.
 *
 * `pluginRoutes` (optional — `../openclaw-host.js`'s shared route table) is
 * this SAME `:path` ingress's fallback for a loaded OpenClaw plugin's
 * `registerHttpRoute(...)`-mounted routes: when no webhook-hook/space-trigger
 * `binding` matches, but `pluginRoutes` has an entry for `path`, the raw
 * request is normalized into a `CompatHttpRequest` and handed to the
 * plugin's handler (which typically calls back into `host.runAgent(...)` —
 * see `../openclaw-host.js`) instead of 404ing. Bindings always win first;
 * a plugin can't shadow a real webhook-hook/space-trigger path.
 */
export function createInboundHandler(
  manager: InboundManager,
  lmthingRoot: string | undefined,
  pluginRoutes?: OpenClawRouteTable,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  return async (req, res, params) => {
    const path = params['path']!;

    if (!lmthingRoot) {
      sendJson(res, 404, { error: { status: 404, message: 'no project root configured' } });
      return;
    }

    const rawBody = await readBody(req);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }

    const projects = (await manager.listProjects()).map((p) => p.id).filter((id) => id !== 'system');
    const binding = await resolveBinding(lmthingRoot, projects, path);
    if (!binding) {
      const pluginRoute = pluginRoutes?.get(path);
      if (pluginRoute) {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const query: Record<string, string | string[] | undefined> = {};
        for (const key of url.searchParams.keys()) {
          const values = url.searchParams.getAll(key);
          query[key] = values.length > 1 ? values : values[0];
        }
        const compatReq: CompatHttpRequest = {
          method: (req.method ?? 'GET').toUpperCase(),
          path,
          headers,
          body: rawBody,
          query,
        };
        try {
          const out = await pluginRoute.handler(compatReq);
          sendJson(res, out.status ?? 200, out.body);
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      sendJson(res, 404, { error: { status: 404, message: `no webhook binding for "${path}"` } });
      return;
    }

    const adapter = getAdapter(binding.provider);
    const secret = resolveWebhookSecret(path, binding.provider);
    if (!adapter.verify(rawBody, headers, secret)) {
      sendJson(res, 401, { error: { status: 401, message: 'signature verification failed' } });
      return;
    }

    const pf = adapter.preflight?.(rawBody, headers) ?? null;
    if (pf) {
      sendJson(res, pf.status, pf.body);
      return;
    }

    const message = adapter.renderMessage(path, rawBody, headers);
    const { spaceRef, agentSlug } = parseTrigger(binding.agentRef);
    const budget = binding.budget as InboundBudget | undefined;

    const threadKey = adapter.extractThread(rawBody, headers);
    const out =
      threadKey === null
        ? await manager.runHeadless({ projectId: binding.projectId, spaceRef, agentSlug, message, budget })
        : await manager.runHeadlessThreaded({
            sessionId: await getOrCreateThreadSession(join(lmthingRoot, binding.projectId), path, threadKey),
            projectId: binding.projectId,
            spaceRef,
            agentSlug,
            message,
            budget,
          });

    sendJson(res, 200, out);
  };
}

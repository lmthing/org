/**
 * Phase 1 (pod side) — inbound-webhook dispatcher.
 *
 * ONE endpoint, `POST /api/inbound/:path`, that an external caller (or the
 * gateway, relaying on the pod's behalf) hits to fire a project's `webhook`
 * hook (`../../app/hooks/loader.ts`'s `WebhookHookDef`). Resolves `:path` to
 * its owning project + `trigger` via `resolveBinding` (`../webhook-manifest.js`),
 * renders the raw request body into an agent message, and runs it headlessly
 * via `manager.runHeadless` — the SAME agent-run seam `routes/hooks.ts` uses
 * for cron/database hooks.
 *
 * Typed structurally (see {@link InboundManager}), mirroring `routes/hooks.ts`'s
 * `HookManager` — decoupled from the concrete `SessionManager` type.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './utils.js';
import { resolveBinding } from '../webhook-manifest.js';

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
 * Render the inbound request into the agent's user message. `provider`
 * selects the adapter; only `'generic'` exists today — it embeds the raw
 * body verbatim. Kept plain text (no JSON.parse) so a non-JSON payload still
 * renders instead of failing the whole request.
 */
function renderInbound(provider: string, path: string, rawBody: string, headers: Record<string, string>): string {
  void provider; // reserved: future providers (e.g. 'stripe', 'github') render differently
  void headers; // reserved: future providers may surface signature/event-type headers
  return (
    `Inbound webhook "${path}" received. Payload (JSON):\n\n${rawBody}\n\nProcess this event.`
  );
}

/**
 * Handler for `POST /api/inbound/:path` — resolves `:path` to its owning
 * project + `trigger` (via {@link resolveBinding}), renders the raw body into
 * an agent message, and dispatches it headlessly. Returns `runHeadless`'s
 * `{ ok, result, error, sessionId }` verbatim.
 */
export function createInboundHandler(
  manager: InboundManager,
  lmthingRoot: string | undefined,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  return async (req, res, params) => {
    const path = params['path']!;

    if (!lmthingRoot) {
      sendJson(res, 404, { error: { status: 404, message: 'no project root configured' } });
      return;
    }

    const rawBody = await readBody(req);

    const projects = (await manager.listProjects()).map((p) => p.id).filter((id) => id !== 'system');
    const binding = await resolveBinding(lmthingRoot, projects, path);
    if (!binding) {
      sendJson(res, 404, { error: { status: 404, message: `no webhook binding for "${path}"` } });
      return;
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }
    const message = renderInbound(binding.provider, path, rawBody, headers);
    const { spaceRef, agentSlug } = parseTrigger(binding.agentRef);

    const out = await manager.runHeadless({
      projectId: binding.projectId,
      spaceRef,
      agentSlug,
      message,
      budget: binding.budget as InboundBudget | undefined,
    });

    sendJson(res, 200, out);
  };
}

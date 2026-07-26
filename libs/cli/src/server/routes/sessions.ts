import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAgentApi, agentApiContextFromEntry } from '../../web/agent-api.js';
import { readBody, sendJson } from './utils.js';
import { isUnderMemoryPressure } from '../mem-watchdog.js';
import { readCaller } from '../team-guard.js';
import type { RouteHandler } from '../router.js';
import type { SessionEntry } from '../session-manager.js';

/**
 * On a TEAM pod every member reaches the same server, so a session belongs to
 * whoever opened it: one member must not read, drive or close another's
 * conversation. Editors are exempt — configuring the workspace includes
 * clearing it out — as are sessions with no recorded owner (created before this
 * existed, or on a personal pod, where there is only one user anyway).
 */
function callerMayUseSession(
  req: IncomingMessage,
  entry: SessionEntry,
): boolean {
  const caller = readCaller(req);
  if (!caller) return true; // personal pod — no team identity in play
  if (caller.role === 'editor') return true;
  if (!entry.ownerId) return true;
  return entry.ownerId === caller.userId;
}

export const handleCreateSession: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  // Backpressure under hard memory pressure (P3): refuse a new VM rather than risk
  // an OOMKill. The watchdog is already shedding idle sessions; retry shortly.
  if (isUnderMemoryPressure()) {
    res.setHeader('Retry-After', '5');
    sendJson(res, 503, { error: 'pod under memory pressure — retry shortly' });
    return;
  }
  const body = await readBody(req);
  const parsed = JSON.parse(body || '{}') as {
    spaceDir?: string; agentSlug?: string; spaceRef?: string; model?: string; projectId?: string;
    resumeSessionId?: string;
    budget?: { maxEpisodes?: number; maxToolCalls?: number; maxForkDepth?: number; maxWallClockMs?: number };
  };
  try {
    const { sessionId } = ctx.manager.createSession({
      spaceDir: parsed.spaceDir,
      agentSlug: parsed.agentSlug,
      spaceRef: parsed.spaceRef,
      model: parsed.model,
      budget: parsed.budget,
      projectId: parsed.projectId,
      resumeSessionId: parsed.resumeSessionId,
      // Stamp the verified caller so team members can't reach each other's
      // conversations. Undefined on a personal pod.
      ...(readCaller(req) ? { ownerId: readCaller(req)!.userId } : {}),
    });
    sendJson(res, 201, { sessionId });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
};

export const handleListSessions: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  sendJson(res, 200, { sessions: ctx.manager.listSessions() });
};

export const handleDeleteSession: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const id = params['id']!;
  const entry = ctx.manager.getSession(id);
  if (!entry) { sendJson(res, 404, { error: `unknown session "${id}"` }); return; }
  if (!callerMayUseSession(req, entry)) {
    sendJson(res, 403, { error: 'that conversation belongs to another member' });
    return;
  }
  await ctx.manager.disposeSession(id);
  sendJson(res, 200, { ok: true });
};

/**
 * Catch-all for all per-session sub-routes: /message, /state, /trace, /asks/:askId, etc.
 * The router.ts pattern `/api/sessions/:id/*` passes `params.rest` which we remap
 * to `/api/<rest>` for the existing handleAgentApi.
 */
export const handleSessionSubRoute: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const id = params['id']!;
  const rest = params['rest'] ? `/${params['rest']}` : '';
  const entry = ctx.manager.getSession(id);
  if (!entry) { sendJson(res, 404, { error: `unknown session "${id}"` }); return; }
  if (!callerMayUseSession(req, entry)) {
    sendJson(res, 403, { error: 'that conversation belongs to another member' });
    return;
  }
  const pathOverride = `/api${rest}`;
  const agentCtx = agentApiContextFromEntry(entry, {
    // `sendMessage` is fire-and-forget (POST /message returns 202 while the turn runs).
    // Its promise CAN reject before the run promise exists — a message POSTed to a
    // still-initializing/resuming session throws "still initializing", and attachment
    // assembly can fail — so a dropped rejection here becomes an unhandledRejection that
    // crashes the whole pod process and, because the client retries, CRASHLOOPS it. Catch
    // it and route it to the session's error stream, exactly as the WS path does
    // (ws/agent.ts), so the client sees a retryable error instead of a dead pod.
    sendMessage: (content) =>
      void ctx.manager.sendMessage(id, content).catch((err) => {
        entry.renderHost.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }),
    broadcastUiControl: ctx.broadcastUiControl(entry),
  });
  const handled = await handleAgentApi(req, res, agentCtx, { pathOverride });
  if (!handled) sendJson(res, 404, { error: `unknown API route ${req.method ?? 'GET'} ${req.url ?? '/'}` });
};

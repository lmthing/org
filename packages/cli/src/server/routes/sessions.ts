import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAgentApi, agentApiContextFromEntry } from '../../web/agent-api.js';
import { readBody, sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';

export const handleCreateSession: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  const body = await readBody(req);
  const parsed = JSON.parse(body || '{}') as {
    spaceDir?: string; agentSlug?: string; model?: string; projectId?: string;
    resumeSessionId?: string;
    budget?: { maxEpisodes?: number; maxToolCalls?: number; maxForkDepth?: number; maxWallClockMs?: number };
  };
  try {
    const { sessionId } = ctx.manager.createSession({
      spaceDir: parsed.spaceDir,
      agentSlug: parsed.agentSlug,
      model: parsed.model,
      budget: parsed.budget,
      projectId: parsed.projectId,
      resumeSessionId: parsed.resumeSessionId,
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
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  ctx,
): Promise<void> => {
  const id = params['id']!;
  const entry = ctx.manager.getSession(id);
  if (!entry) { sendJson(res, 404, { error: `unknown session "${id}"` }); return; }
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
  const pathOverride = `/api${rest}`;
  const agentCtx = agentApiContextFromEntry(entry, {
    sendMessage: (content) => ctx.manager.sendMessage(id, content),
    broadcastUiControl: ctx.broadcastUiControl(entry),
  });
  const handled = await handleAgentApi(req, res, agentCtx, { pathOverride });
  if (!handled) sendJson(res, 404, { error: `unknown API route ${req.method ?? 'GET'} ${req.url ?? '/'}` });
};

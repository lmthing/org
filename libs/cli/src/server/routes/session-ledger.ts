import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';

/**
 * GET /api/session-ledger — the pod-global ledger of every session (chat +
 * hook/code-node) and the delegates each made, with token/cost accounting.
 * Backs the Sessions tab in the settings dialog. Newest-first, bounded.
 */
export const handleListSessionLedger: RouteHandler = async (
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
  ctx,
): Promise<void> => {
  sendJson(res, 200, { sessions: ctx.manager.listSessionLedger(200) });
};

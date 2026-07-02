import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';

/**
 * GET /api/budget — remaining budget per rolling window (1d / 7d / 30d).
 *
 * The pod can't compute this itself: it only holds the user's LiteLLM key, and an
 * over-budget key is 429'd by LiteLLM on ALL calls (including reads) — exactly when
 * the indicator matters most. So we forward to the cloud gateway, which computes it
 * with the master key (bypasses the per-key budget gate). Envoy validates the
 * gateway JWT and forwards the `Authorization` header to the pod, so we relay it.
 *
 * Off-cloud / local pods (no gateway reachable or no auth) return 404, which the
 * UI treats as "hidden".
 */
const GATEWAY_URL =
  process.env.LMTHING_GATEWAY_URL || 'http://gateway.lmthing.svc.cluster.local:3000';

export const handleBudget: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const auth = req.headers['authorization'];
  if (!auth) {
    sendJson(res, 404, { error: 'budget not available' });
    return;
  }
  try {
    const r = await fetch(`${GATEWAY_URL}/api/billing/budget`, {
      headers: { Authorization: auth },
    });
    const body = await r.text();
    res.writeHead(r.ok ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(r.ok ? body : JSON.stringify({ error: 'budget not available' }));
  } catch {
    sendJson(res, 404, { error: 'budget not available' });
  }
};

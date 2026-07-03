import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './utils.js';
import type { RouteHandler } from '../router.js';
import { reportBug } from '../report-bug.js';

/**
 * Browser → pod → gateway bug-report broker. The browser posts the report +
 * sessionId; the pod attaches the session's trace history and forwards it to
 * the gateway's /api/issues, relaying the gateway's response verbatim.
 */
export const handleReportBug: RouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
  _params,
  ctx,
): Promise<void> => {
  try {
    let parsed: { title?: unknown; message?: unknown; sessionId?: unknown; screenshot?: unknown };
    try {
      parsed = JSON.parse((await readBody(req)) || '{}') as typeof parsed;
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }

    const title = parsed.title;
    const message = parsed.message;
    const sessionId = parsed.sessionId;
    const screenshot = parsed.screenshot;

    if (typeof title !== 'string' || title.trim().length === 0) {
      sendJson(res, 400, { error: 'title must be a non-empty string' });
      return;
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      sendJson(res, 400, { error: 'message must be a non-empty string' });
      return;
    }
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      sendJson(res, 400, { error: 'sessionId must be a non-empty string' });
      return;
    }
    if (screenshot !== undefined && typeof screenshot !== 'string') {
      sendJson(res, 400, { error: 'screenshot must be a string when provided' });
      return;
    }

    const authHeader = req.headers['authorization'];

    const { status, body } = await reportBug({
      sessionId,
      title,
      message,
      screenshot,
      authHeader,
      ctx,
    });
    sendJson(res, status, body);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'report-bug failed' });
  }
};

import type { ServerContext } from './router.js';

/**
 * Pod-side broker: forwards a bug report (with the session's trace history) to
 * the cloud gateway, which files a GitHub issue. Mirrors the GATEWAY_URL
 * convention used by backup.ts.
 */

const GATEWAY_URL =
  process.env.LMTHING_GATEWAY_URL || 'http://gateway.lmthing.svc.cluster.local:3000';

export interface ReportBugOpts {
  sessionId: string;
  title: string;
  message: string;
  screenshot?: string;
  authHeader: string | undefined;
  ctx: ServerContext;
}

export async function reportBug(
  opts: ReportBugOpts,
): Promise<{ status: number; body: unknown }> {
  const { sessionId, title, message, screenshot, authHeader, ctx } = opts;
  try {
    const entry = ctx.manager.getSession(sessionId);
    if (!entry) {
      return { status: 404, body: { error: 'session not found' } };
    }

    const snapshot = entry.hub.snapshot();
    const trace = snapshot.events.map((w) => JSON.stringify(w.event)).join('\n');

    const res = await fetch(`${GATEWAY_URL}/api/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ title, message, trace, screenshot }),
    });

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text || `gateway returned ${res.status}` };
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 502, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

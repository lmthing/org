/**
 * `<Chat>` protocol helpers — the pure, DOM-free logic behind the chat widget.
 *
 * Kept out of `chat.tsx` so it stays node-importable (no React, no
 * `@lmthing/ui`) and cheaply unit-testable: `chat.tsx` pulls `@lmthing/ui/chat`,
 * which only resolves inside the pages esbuild build (via its `nodePaths`), not
 * under the plain vitest runner. These helpers depend on nothing but the shared
 * {@link resolveAppBase}.
 */
import { resolveAppBase } from './client.js';

/**
 * Resolve the `projectId` this page belongs to from `window.location`.
 *
 * The identical page build is served under several `…/app/<project>/` prefixes;
 * {@link resolveAppBase} recovers the `…/app/<project>` base (honouring a
 * `window.__APP_BASE__` override on the `/app`-stripped host) and the project is
 * its final segment.
 */
export function resolveProjectId(pathname: string, override?: string): string {
  const base = resolveAppBase(pathname, override);
  return base.split('/').filter(Boolean).pop() ?? '';
}

/**
 * The `POST /api/sessions` body for an in-app chat.
 *
 * Two shapes, both accepted by the sessions route (`routes/sessions.ts:L20-L35`):
 *
 * - `"space/agent"` → `{ spaceRef, projectId }` — a PROJECT space's agent, resolved under
 *   `<project>/spaces/<space>` (a concierge, a curator: an agent the app itself owns).
 * - `"thing"` (any bare slug, no `/`) → `{ agentSlug, projectId }` — the project's own
 *   top-level agent. This is the ONE that makes an app a living surface: it is the SAME
 *   THING the `/chat` surface talks to, scoped to this project, with its full authoring
 *   capability — so from inside the app the user can ask for a new table, page, space or
 *   integration and it lands live. A `spaceRef` cannot express that (THING is not a project
 *   space), which is why an app-embedded chat could previously only reach a lesser agent.
 */
export function sessionCreateBody(
  agent: string,
  projectId: string,
): { spaceRef: string; projectId: string } | { agentSlug: string; projectId: string } {
  return agent.includes('/') ? { spaceRef: agent, projectId } : { agentSlug: agent, projectId };
}

/**
 * Same-origin HTTP base for the pod chat endpoints (`protocol//host`).
 * `useReplSession`/`ReplRpcClient` derives the WS url from it by swapping the
 * scheme (`http→ws`, `https→wss`), yielding `wss://host/api/ws?sessionId=<id>`.
 */
export function originBase(loc: { protocol: string; host: string } = window.location): string {
  return `${loc.protocol}//${loc.host}`;
}

/**
 * Create the pod chat session for `agent` (`space/agent`) scoped to `projectId`.
 * POSTs the Phase 7A `{ spaceRef, projectId }` body to `<base>/api/sessions` and
 * returns the new `sessionId`.
 *
 * On the platform, `/api/*` is the JWT-authenticated per-user pod proxy (Envoy
 * `app-api-proxy`) — a bare fetch is 401. When `accessToken` is supplied (the
 * platform `@lmthing/auth` session, same-origin with the app page) it's sent as
 * `Authorization: Bearer`, exactly as the main chat UI does. Omitted in
 * local/no-auth mode (direct pod), where `/api/*` needs no token.
 */
export async function createChatSession(
  agent: string,
  projectId: string,
  base: string,
  accessToken?: string,
): Promise<string> {
  const res = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(sessionCreateBody(agent, projectId)),
  });
  if (!res.ok) {
    throw new Error(`session create failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const { sessionId } = (await res.json()) as { sessionId: string };
  return sessionId;
}

/** One past conversation of a project, for the dock's history switcher. */
export interface ChatSessionMeta {
  sessionId: string;
  title?: string;
  lastActivity: number;
}

/**
 * List a project's past conversations (`GET /api/projects/:id/sessions`), newest first, for the
 * in-dock history switcher. Same JWT-gated `/api/*` proxy + optional Bearer token as
 * {@link createChatSession}; a failure yields `[]` rather than throwing — a missing history is a
 * quiet empty list, never a broken dock.
 */
export async function listChatSessions(
  projectId: string,
  base: string,
  accessToken?: string,
): Promise<ChatSessionMeta[]> {
  try {
    const res = await fetch(`${base}/api/projects/${encodeURIComponent(projectId)}/sessions`, {
      headers: { ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    });
    if (!res.ok) return [];
    const { sessions } = (await res.json()) as { sessions?: ChatSessionMeta[] };
    return (sessions ?? []).slice().sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  } catch {
    return [];
  }
}

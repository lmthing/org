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

/** The `POST /api/sessions` body Phase 7A expects: `{ spaceRef, projectId }`. */
export function sessionCreateBody(
  agent: string,
  projectId: string,
): { spaceRef: string; projectId: string } {
  return { spaceRef: agent, projectId };
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
 */
export async function createChatSession(
  agent: string,
  projectId: string,
  base: string,
): Promise<string> {
  const res = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sessionCreateBody(agent, projectId)),
  });
  if (!res.ok) {
    throw new Error(`session create failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const { sessionId } = (await res.json()) as { sessionId: string };
  return sessionId;
}

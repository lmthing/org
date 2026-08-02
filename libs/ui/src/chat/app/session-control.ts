import { connectLive, useStore } from '../store/store';
import { apiPost } from './api';
import { wsTokenSuffix } from './auth';
import { setLiveSend } from './live-send';
import { wsUrl } from '../../platform/api-base';
import { getWindowSize } from '../../platform/dimensions';

/**
 * Opening, switching and ending the live chat session — the one place that owns the socket.
 *
 * This lived inside `Sidebar.tsx` as module state, which made "start a chat" a thing only the
 * sidebar could do. That is fine on web, where the sidebar is docked and always on screen. On a
 * phone it is an overlay drawer, so the shell's no-session pane could only *tell* the user to go
 * to a sidebar that was not visible — a dead end with no way out. Both surfaces now call in here.
 *
 * Since the surface became routable, the socket follows the LOCATION rather than a click:
 * `ChatShell` runs {@link openSession} whenever the open conversation changes, so a deep link, a
 * sidebar click and the browser's Back button all arrive through the same door.
 */

let activeConn: ReturnType<typeof connectLive> | null = null;
let connectedSessionId: string | null = null;

/**
 * Guards against the interleaving that back/forward makes easy: two `openSession` calls in flight,
 * the FIRST one's POST resolving last, and the surface landing on the conversation the user had
 * already navigated away from. Every call takes a token; only the newest one is still allowed to
 * touch the socket when its await comes back.
 */
let openToken = 0;

/** The conversation the socket is currently attached to, or `null`. */
export function getConnectedSessionId(): string | null {
  return connectedSessionId;
}

/** Point the store and the socket at `sessionId`, tearing down any previous connection. */
export function switchSession(sessionId: string): void {
  if (activeConn) { activeConn.close(); activeConn = null; }
  useStore.getState().resetSession();
  activeConn = connectLive(wsUrl(`/api/ws?sessionId=${encodeURIComponent(sessionId)}${wsTokenSuffix()}`));
  connectedSessionId = sessionId;
  setLiveSend(activeConn.send);
  useStore.getState().setActiveSessionId(sessionId);
  // On mobile the sidebar is an overlay drawer — close it so the conversation shows.
  if (getWindowSize().width < 768) useStore.getState().setSidebarOpen(false);
}

/**
 * Drop the live connection and the send handle. The handle matters: `window.__LM_SEND__` used to be
 * left pointing at a closed socket here, so a composer submit after deleting the active session was
 * dropped in silence.
 */
export function closeActiveSession(): void {
  // Bump the token even when nothing is open: an `openSession` may be mid-flight, and without this
  // its POST would come back and attach a socket to the conversation we just left.
  openToken++;
  connectedSessionId = null;
  if (!activeConn) return;
  activeConn.close();
  activeConn = null;
  setLiveSend(null);
}

/**
 * Attach the surface to `sessionId`, resuming it pod-side if it is not already live.
 *
 * Idempotent by design — it is called from an effect that re-runs on every location change, and
 * the common case (the conversation is already the connected one) must not tear down a working
 * socket. Rejects when the id names no saved session, which is how a stale link becomes a visible
 * "this conversation is gone" pane instead of a blank screen.
 */
export async function openSession(projectId: string | null, sessionId: string): Promise<void> {
  if (connectedSessionId === sessionId) return;
  const token = ++openToken;
  // `POST /api/sessions {resumeSessionId}` returns the SAME id — an already-live session comes
  // straight back, a persisted one is rehydrated from its snapshot first. So this is both "is it
  // real?" and "make it live", and the conversation's id is stable enough to put in a URL.
  await apiPost<{ sessionId: string }>('/api/sessions', {
    ...(projectId ? { projectId } : {}),
    resumeSessionId: sessionId,
  });
  if (token !== openToken) return; // a newer open (or a close) won the race
  switchSession(sessionId);
}

/**
 * Create a fresh session in `projectId` and connect to it.
 *
 * It connects here rather than leaving it to the location effect purely to save a round trip: the
 * POST that created it already made it live, so the effect that follows the navigation sees its id
 * already connected and does nothing.
 */
export async function startSession(projectId: string): Promise<string> {
  const { sessionId } = await apiPost<{ sessionId: string }>('/api/sessions', { projectId });
  openToken++; // this is now the newest intent — see the field's comment
  switchSession(sessionId);
  return sessionId;
}

/** Resume a persisted session and make it the active one. Kept for callers that want the id back. */
export async function resumeSession(projectId: string, resumeSessionId: string): Promise<string> {
  await openSession(projectId, resumeSessionId);
  return resumeSessionId;
}

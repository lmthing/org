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
 */

let activeConn: ReturnType<typeof connectLive> | null = null;

/** Point the store and the socket at `sessionId`, tearing down any previous connection. */
export function switchSession(sessionId: string): void {
  if (activeConn) { activeConn.close(); activeConn = null; }
  useStore.getState().resetSession();
  activeConn = connectLive(wsUrl(`/api/ws?sessionId=${encodeURIComponent(sessionId)}${wsTokenSuffix()}`));
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
  if (!activeConn) return;
  activeConn.close();
  activeConn = null;
  setLiveSend(null);
}

/** Create a fresh session in `projectId` and make it the active one. */
export async function startSession(projectId: string): Promise<string> {
  const { sessionId } = await apiPost<{ sessionId: string }>('/api/sessions', { projectId });
  switchSession(sessionId);
  return sessionId;
}

/** Resume a persisted session (the pod forks it a new id) and make that the active one. */
export async function resumeSession(projectId: string, resumeSessionId: string): Promise<string> {
  const { sessionId } = await apiPost<{ sessionId: string }>('/api/sessions', { projectId, resumeSessionId });
  switchSession(sessionId);
  return sessionId;
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { Shell } from './shell.js';
import { AppShell } from './AppShell.js';
import { useStore, connectLive, type Project } from '../store/store.js';
import { parseTrace } from './replay.js';
import { initTheme } from '../theme/theme.js';
import { authHeaders, wsTokenSuffix, getAccessToken } from './auth.js';
import { AgentChatPanel } from '../components/AgentChatPanel.js';
import { applyUrlToState, syncStateToUrl } from './url-state.js';

// Expose React for runtime-bundled space components that reference it (defensive;
// the runtime bundle shares this React instance directly).
const w = window as unknown as {
  __WS_URL__?: string;
  __LM_PROJECT_MODE__?: boolean;
  __LM_ACCESS_TOKEN__?: string;
  __LM_SEND__?: (m: unknown) => void;
  __LMTHING_REACT__?: unknown;
  React?: unknown;
};
w.__LMTHING_REACT__ = React;

export function mountApp(): void {
  void boot();
}

async function boot(): Promise<void> {
  initTheme();

  const params = new URLSearchParams(window.location.search);
  const traceUrl = params.get('trace');
  const sessionIdParam = params.get('sessionId');

  // ── Detect operating mode ────────────────────────────────────────────────
  //
  // 1. Legacy / direct: __WS_URL__ injected by the server (old single-session path)
  // 2. Direct ?sessionId=: opened with a specific session (single session)
  // 3. Shell / multi-session: the project server flags __LM_PROJECT_MODE__ (and
  //    injects __WS_URL__ only for a specific ?sessionId=), so with no session and
  //    no trace we mount the project/session Shell. Also falls back to shell when
  //    no WS URL was injected at all.
  const projectMode = Boolean(w.__LM_PROJECT_MODE__);
  const hasLegacyWs = Boolean(w.__WS_URL__);
  const isShellMode = (projectMode || !hasLegacyWs) && !sessionIdParam && !traceUrl;

  // Embedded = rendered inside an iframe, or explicitly requested with ?embed=1.
  // A direct (standalone) visit to lmthing.chat is NOT embedded.
  const isEmbedded =
    params.get('embed') === '1' ||
    (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true; // cross-origin frame access throws → we're embedded
      }
    })();

  if (isShellMode && isEmbedded) {
    // ── Embedded chat-only mode ──────────────────────────────────────────────
    // When embedded, the pod serves a single, self-contained chat panel for its
    // `thing` agent — no project/session shell, no DevPanel.
    const root = createRoot(document.getElementById('root')!);
    root.render(
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AgentChatPanel
          computeBaseUrl={window.location.origin}
          getAccessToken={() => getAccessToken() ?? ''}
          target={{ mode: 'agentOnly', agentSlug: 'thing' }}
          style={{ flex: 1, minHeight: 0 }}
        />
      </div>,
    );
    return;
  }

  if (isShellMode) {
    // ── Shell mode: standalone (e.g. lmthing.chat) — project + session
    // management with the sidebar and the DevPanel ("inspect").
    const root = createRoot(document.getElementById('root')!);
    root.render(<AppShell />);

    // Pre-load projects and pick a default.
    try {
      const res = await fetch('/api/projects', { headers: authHeaders() });
      if (res.ok) {
        const { projects } = (await res.json()) as { projects: Project[] };
        useStore.getState().setProjects(projects);
        // Default-select 'user' project if it exists (id='user' is the
        // personal project), else first project.
        const defaultProject =
          projects.find((p) => p.id === 'user') ?? projects[0];
        if (defaultProject) {
          useStore.getState().setActiveProjectId(defaultProject.id);
        }
      }
    } catch {
      // No project API available yet — shell renders with empty sidebar.
    }

    applyUrlToState();
    syncStateToUrl();
    return;
  }

  // ── Single-session mode (legacy or ?sessionId=) ─────────────────────────
  const root = createRoot(document.getElementById('root')!);
  root.render(<AppShell singleSession />);

  if (traceUrl) {
    // Replay mode — fetch and load the trace, no WS.
    try {
      const res = await fetch(traceUrl);
      const text = await res.text();
      useStore.getState().loadReplay(parseTrace(text));
    } catch (err) {
      useStore.getState().noteError(`failed to load trace ${traceUrl}: ${String(err)}`);
    }
  } else if (sessionIdParam) {
    // ?sessionId= direct link — connect to that specific session's WS.
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/ws?sessionId=${encodeURIComponent(sessionIdParam)}${wsTokenSuffix()}`;
    const conn = connectLive(wsUrl);
    w.__LM_SEND__ = conn.send;
    useStore.getState().setActiveSessionId(sessionIdParam);
  } else {
    // Legacy: __WS_URL__ injected by the server.
    const wsUrl = w.__WS_URL__ ?? `ws://${window.location.host}`;
    const conn = connectLive(wsUrl);
    w.__LM_SEND__ = conn.send;
  }

  applyUrlToState();
  syncStateToUrl();
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { Shell } from './shell.js';
import { useStore, connectLive, type InspectorTab, type Project } from '../store/store.js';
import { parseTrace } from './replay.js';

// Expose React for runtime-bundled space components that reference it (defensive;
// the runtime bundle shares this React instance directly).
const w = window as unknown as {
  __WS_URL__?: string;
  __LM_PROJECT_MODE__?: boolean;
  __LM_SEND__?: (m: unknown) => void;
  __LMTHING_REACT__?: unknown;
  React?: unknown;
};
w.__LMTHING_REACT__ = React;

// ─── URL ↔ state sync (deep-linkable; LLM-friendly) ─────────────────────────
// ?node=<id>&tab=<tab>&follow=0&trace=<url>&sessionId=<id>

function applyUrlToState(): void {
  const params = new URLSearchParams(window.location.search);
  const node = params.get('node');
  const tab = params.get('tab') as InspectorTab | null;
  const follow = params.get('follow');
  const st = useStore.getState();
  if (node) st.selectNode(node, true);
  if (tab) st.setTab(tab);
  if (follow === '0') st.setFollow(false);
}

function syncStateToUrl(): void {
  let lastKey = '';
  useStore.subscribe((s) => {
    const key = `${s.selectedNodeId ?? ''}|${s.tab}|${s.follow ? 1 : 0}`;
    if (key === lastKey) return;
    lastKey = key;
    const params = new URLSearchParams(window.location.search);
    if (s.selectedNodeId) params.set('node', s.selectedNodeId); else params.delete('node');
    params.set('tab', s.tab);
    if (!s.follow) params.set('follow', '0'); else params.delete('follow');
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', url);
  });
}

export function mountApp(): void {
  void boot();
}

async function boot(): Promise<void> {
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

  if (isShellMode) {
    // ── Shell mode: project + session management ────────────────────────────
    const root = createRoot(document.getElementById('root')!);
    root.render(<Shell />);

    // Pre-load projects and pick a default.
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const { projects } = (await res.json()) as { projects: Project[] };
        useStore.getState().setProjects(projects);
        // Default-select 'user' project if it exists, else first project.
        const defaultProject =
          projects.find((p) => p.name === 'user') ?? projects[0];
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
  root.render(<App />);

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
    const wsUrl = `${proto}//${window.location.host}/api/ws?sessionId=${encodeURIComponent(sessionIdParam)}`;
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

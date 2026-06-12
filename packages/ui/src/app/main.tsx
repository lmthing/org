import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { useStore, connectLive, type InspectorTab } from '../store/store.js';
import { parseTrace } from './replay.js';

// Expose React for runtime-bundled space components that reference it (defensive;
// the runtime bundle shares this React instance directly).
const w = window as unknown as {
  __WS_URL__?: string;
  __LM_SEND__?: (m: unknown) => void;
  __LMTHING_REACT__?: unknown;
  React?: unknown;
};
w.__LMTHING_REACT__ = React;

// ─── URL ↔ state sync (deep-linkable; LLM-friendly) ─────────────────────────
// ?node=<id>&tab=<tab>&follow=0&trace=<url>

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
  const root = createRoot(document.getElementById('root')!);
  root.render(<App />);

  const params = new URLSearchParams(window.location.search);
  const traceUrl = params.get('trace');

  if (traceUrl) {
    // Replay mode — fetch and load the trace, no WS.
    try {
      const res = await fetch(traceUrl);
      const text = await res.text();
      useStore.getState().loadReplay(parseTrace(text));
    } catch (err) {
      useStore.getState().noteError(`failed to load trace ${traceUrl}: ${String(err)}`);
    }
  } else {
    // Live mode.
    const wsUrl = w.__WS_URL__ ?? `ws://${window.location.host}`;
    const conn = connectLive(wsUrl);
    w.__LM_SEND__ = conn.send;
  }

  applyUrlToState();
  syncStateToUrl();
}

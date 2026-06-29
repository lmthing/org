import React, { useEffect } from 'react';
import { useStore, type Project, type InspectorTab } from '../store/store.js';
import { authHeaders } from './auth.js';
import { AppShell } from './AppShell.js';

// ─── URL ↔ state sync (deep-linkable; LLM-friendly) ─────────────────────────
// ?node=<id>&tab=<tab>&follow=0  (lifted from main.tsx boot() shell branch so the
// /chat route can render the full agent-ui shell as a plain component.)

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

/** Subscribe store changes back into the URL. Returns an unsubscribe fn. */
function syncStateToUrl(): () => void {
  let lastKey = '';
  return useStore.subscribe((s) => {
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

/**
 * The standalone agent-ui chat shell (sidebar + transcript + DevPanel), packaged
 * as a component so it can be rendered at the `/chat` route of the unified web
 * app (mirrors main.tsx boot()'s shell-mode branch: render AppShell, preload
 * projects, and wire URL ↔ state).
 */
export function ChatShell(): React.ReactElement {
  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      // Pre-load projects and pick a default.
      try {
        const res = await fetch('/api/projects', { headers: authHeaders() });
        if (res.ok) {
          const { projects } = (await res.json()) as { projects: Project[] };
          useStore.getState().setProjects(projects);
          const defaultProject =
            projects.find((p) => p.id === 'user') ?? projects[0];
          if (defaultProject) {
            useStore.getState().setActiveProjectId(defaultProject.id);
          }
        }
      } catch {
        // No project API available — shell renders with empty sidebar.
      }
      applyUrlToState();
      unsub = syncStateToUrl();
    })();
    return () => {
      unsub?.();
    };
  }, []);

  return <AppShell />;
}

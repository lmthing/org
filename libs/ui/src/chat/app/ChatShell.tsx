import React, { useEffect } from 'react';
import { useStore, type Project } from '../store/store.js';
import { authHeaders } from './auth.js';
import { AppShell } from './AppShell.js';
import { applyUrlToState, syncStateToUrl } from './url-state.js';

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
      // Pre-load projects and pick a default. PodEnsureGate has already
      // confirmed the pod's edge is serving before mounting us, so a single
      // fetch is safe here (no cold-wake race to retry around).
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

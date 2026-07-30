import React, { useEffect } from 'react';
import { useStore, type Project } from '../store/store';
import { authHeaders } from './auth';
import { apiUrl } from '../../platform/api-base';
import { AppShell } from './AppShell';
import { applyUrlToState, syncStateToUrl } from './url-state';
import type { Surface } from '../../elements/nav/surface-switcher';

interface ChatShellProps {
  /** Forwarded to `AppShell` — see its doc comment. */
  onSwitchSurface?: (surface: Surface) => void;
  /** Forwarded to `AppShell`. */
  surfaceBadges?: Partial<Record<Surface, number>>;
}

/**
 * The standalone agent-ui chat shell (sidebar + transcript + DevPanel), packaged
 * as a component so it can be rendered at the `/chat` route of the unified web
 * app (mirrors main.tsx boot()'s shell-mode branch: render AppShell, preload
 * projects, and wire URL ↔ state).
 */
export function ChatShell({ onSwitchSurface, surfaceBadges }: ChatShellProps = {}): React.ReactElement {
  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      // Pre-load projects and pick a default. PodEnsureGate has already
      // confirmed the pod's edge is serving before mounting us, so a single
      // fetch is safe here (no cold-wake race to retry around).
      try {
        const res = await fetch(apiUrl('/api/projects'), { headers: authHeaders() });
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

  return <AppShell onSwitchSurface={onSwitchSurface} surfaceBadges={surfaceBadges} />;
}

// ─── Multi-session / project slice ───────────────────────────────────────────
// Owns the project/session lists surfaced by the sidebar (Studio-style
// multi-project chat) — independent of the live/replay execution state.

import type { AppState, Project, SessionMeta } from './types';

export interface ProjectSlice {
  projects: Project[];
  activeProjectId: string | null;
  sessions: SessionMeta[];
  activeSessionId: string | null;
  setProjects: (projects: Project[]) => void;
  setActiveProjectId: (id: string | null) => void;
  setSessions: (sessions: SessionMeta[]) => void;
  setActiveSessionId: (id: string | null) => void;
}

export function createProjectSlice(
  set: (partial: Partial<AppState>) => void,
): ProjectSlice {
  return {
    projects: [],
    activeProjectId: null,
    sessions: [],
    activeSessionId: null,

    setProjects: (projects) => set({ projects }),
    setActiveProjectId: (id) => set({ activeProjectId: id }),
    setSessions: (sessions) => set({ sessions }),
    setActiveSessionId: (id) => set({ activeSessionId: id }),
  };
}

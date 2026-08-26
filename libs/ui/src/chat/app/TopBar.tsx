import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { useStore, type Project, type ModelPricing } from '../store/store';
import { apiGet, apiPost, apiDelete } from './api';
import { useChatNav } from './chat-nav';
import { ProjectDropdown } from '../../elements/nav/app-sidebar';
import { SurfaceSwitcher, type Surface } from '../../elements/nav/surface-switcher';
import { Settings } from '../../elements/primitives/icons';

interface TopBarProps {
  onProjectSettings?: (projectId: string, name: string) => void;
  /** Forwarded to the `SurfaceSwitcher` — see that component's doc comment. */
  onSwitchSurface?: (surface: Surface) => void;
  surfaceBadges?: Partial<Record<Surface, number>>;
}

/**
 * The `/chat` top bar — the project switcher on the left, the surface switcher on the right.
 *
 * It replaces the former left sidebar entirely: now that a selected project renders its app inline
 * (`AppInline`) and the app supplies its OWN sidebar nav + assistant dock, a second `/chat` sidebar
 * would be a duplicate nav. What the old sidebar uniquely held — switching/creating projects — moves
 * here, into a slim bar above the app.
 *
 * Selecting a project is a NAVIGATION (`nav.openProject`), never a store write — `ChatShell` turns
 * the new location back into `activeProjectId`, so this reads it but never sets it.
 */
export function TopBar({ onProjectSettings, onSwitchSurface, surfaceBadges }: TopBarProps): React.ReactElement {
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setProjects = useStore((s) => s.setProjects);
  const setPrices = useStore((s) => s.setPrices);
  const nav = useChatNav();

  // Keep the list fresh (picking a default when none is named is the shell's job, not this bar's).
  React.useEffect(() => {
    apiGet<{ projects: Project[] }>('/api/projects')
      .then((r) => setProjects(r.projects))
      .catch(() => {});
  }, [setProjects]);

  // Per-model pricing for ChatView's live session cost — this bar is the always-present chat chrome
  // now, so it owns the fetch the removed sidebar used to.
  React.useEffect(() => {
    apiGet<Record<string, ModelPricing>>('/api/prices/azure')
      .then(setPrices)
      .catch(() => {});
  }, [setPrices]);

  const createProject = async (name: string) => {
    await apiPost<{ id: string }>('/api/projects', { name });
    const r = await apiGet<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
    const created = r.projects.find((p) => p.name === name);
    if (created) nav.openProject(created.id);
  };

  const deleteProject = async (id: string) => {
    // Leave BEFORE deleting so the pane never flashes "that project isn't here" for a deliberate act.
    if (activeProjectId === id) {
      const next = projects.find((p) => p.id !== id);
      nav.redirect({ projectId: next?.id ?? null, sessionId: null });
    }
    await apiDelete(`/api/projects/${id}`);
    const r = await apiGet<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
  };

  const active = projects.find((p) => p.id === activeProjectId);

  return (
    <Prim.Row
      alignItems="center"
      gap="$2"
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderBottomWidth={1}
      borderColor="$border"
      backgroundColor="$card"
      flexShrink={0}
      zIndex={20}
    >
      <Prim.Box width={240} maxWidth="60%">
        <ProjectDropdown
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={(id) => nav.openProject(id)}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
        />
      </Prim.Box>
      {active && onProjectSettings && (
        <Prim.Pressable
          onClick={() => onProjectSettings(active.id, active.name)}
          width="$8"
          height="$8"
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="$radius"
          color="$muted-foreground"
          hoverStyle={{ color: '$foreground', backgroundColor: '$muted' }}
          title="Project settings"
          aria-label="Project settings"
        >
          <Settings size={16} aria-hidden={true} />
        </Prim.Pressable>
      )}
      <Prim.Box flexGrow={1} />
      <SurfaceSwitcher current="chat" onSwitch={onSwitchSurface} badges={surfaceBadges} bordered />
    </Prim.Row>
  );
}

import React from 'react';
import { useStore } from '../store/store';
import type { Project, ModelPricing } from '../store/store';
import { apiGet, apiPost, apiDelete } from './api';
import { useChatNav } from './chat-nav';
import { AppSidebar, type AppSidebarPage } from '../../elements/nav/app-sidebar';
import { SurfaceSwitcher, type Surface } from '../../elements/nav/surface-switcher';
import { crossAppOrigin, projectAppUrl } from '../../lib/app-urls';
import { openUrl } from '../../platform/navigation';
import { useAppPages, pageLabel } from './use-app-pages';

interface SpaceMeta { id: string; name: string }

interface SidebarProps {
  onProjectSettings?: (projectId: string, name: string) => void;
  className?: string;
  /** Forwarded to the sidebar shell — the mobile drawer needs `width: '100%'`. */
  width?: number | string;
  height?: number | string;
  /** Disable the whole-sidebar collapse control (e.g. inside a mobile drawer). */
  collapsible?: boolean;
  /** Forwarded to the footer's `SurfaceSwitcher` — see its doc comment for what presence/absence
   *  of `onSwitchSurface` changes. */
  onSwitchSurface?: (surface: Surface) => void;
  /** Forwarded to the footer's `SurfaceSwitcher`. */
  surfaceBadges?: Partial<Record<Surface, number>>;
  /**
   * How the host opens an app page from the `APP` section. When provided (the mobile host), a page
   * row calls this with the active project and the tapped route so the host can render it NATIVELY
   * (via `@lmthing/ui/view`) instead of opening the pod's `/app/<project>/…` mount. Absent on web,
   * where the rows stay real anchors — see `AppSidebar`'s `onOpenAppPage`.
   */
  onOpenAppPage?: (project: { id: string; name: string }, routePath: string) => void;
}

/**
 * The chat surface's side menu, now the project's APP NAVIGATION rather than a conversation list.
 *
 * Every project is a served app from birth (a chat page that grows), so selecting one loads the app
 * inline (`AppFrame`), and the thing the reader navigates is the app's PAGES — listed here in the
 * `APP` section — plus the project switcher and the project's spaces. The conversation HISTORY moved
 * into the chat block itself: it lives inside the assistant dock (the modal chat) the served app
 * renders, not in this sidebar. So there is no `Conversations` section and no `New chat` button here
 * anymore — the chat is reached in the dock, where its history is.
 */
export function Sidebar({ onProjectSettings, className, width, height, collapsible = true, onSwitchSurface, surfaceBadges, onOpenAppPage }: SidebarProps) {
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const setProjects = useStore(s => s.setProjects);
  const setPrices = useStore(s => s.setPrices);
  // Selecting a project is a NAVIGATION, not a state write — see `chat-nav.tsx`. The shell turns the
  // new location back into `activeProjectId`, which is why this component reads it but never sets it.
  const nav = useChatNav();

  const [spaces, setSpaces] = React.useState<SpaceMeta[]>([]);
  const [spacesLoading, setSpacesLoading] = React.useState(false);

  const loadSpaces = React.useCallback((projectId: string) => {
    setSpacesLoading(true);
    apiGet<{ spaces: SpaceMeta[] }>(`/api/projects/${projectId}/spaces`)
      .then(r => setSpaces(r.spaces ?? []))
      .catch(() => setSpaces([]))
      .finally(() => setSpacesLoading(false));
  }, []);

  React.useEffect(() => {
    // Refresh the list only. Picking a default when none is named is the SHELL's job now
    // (`ChatShell`, as a replacing redirect to `/chat/<project>`): a sidebar that quietly selected
    // one here would leave the URL saying `/chat` while the app showed a project.
    apiGet<{ projects: Project[] }>('/api/projects')
      .then(r => setProjects(r.projects))
      .catch(() => {});
  }, [setProjects]);

  React.useEffect(() => {
    apiGet<Record<string, ModelPricing>>('/api/prices/azure')
      .then(setPrices).catch(() => {});
  }, [setPrices]);

  React.useEffect(() => {
    if (activeProjectId) loadSpaces(activeProjectId);
    else setSpaces([]);
  }, [activeProjectId, loadSpaces]);

  const activeProject = projects.find(p => p.id === activeProjectId);

  // The selected project's openable app pages — the `APP` section, i.e. the nav bar. A newborn
  // project has just its home (the chat page); as the builder adds real pages this fills out.
  const appPageRoutes = useAppPages(activeProjectId);
  const appPages = React.useMemo<AppSidebarPage[]>(
    () =>
      activeProjectId
        ? appPageRoutes.map(routePath => ({
            routePath,
            label: pageLabel(routePath),
            href: projectAppUrl(activeProjectId, routePath),
          }))
        : [],
    [activeProjectId, appPageRoutes],
  );

  const createProject = async (name: string) => {
    await apiPost<{ id: string }>('/api/projects', { name });
    const r = await apiGet<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
    const created = r.projects.find(p => p.name === name);
    if (created) nav.openProject(created.id);
  };

  const deleteProject = async (id: string) => {
    // Leave BEFORE deleting, not after. The location is the source of truth for what is on screen,
    // so a list that no longer contains the project we are still pointed at renders "that project
    // isn't here" for as long as it takes the navigation to land — a flash of an error for
    // something the user did on purpose and that worked.
    if (activeProjectId === id) {
      const next = projects.find(p => p.id !== id);
      nav.redirect({ projectId: next?.id ?? null, sessionId: null });
    }
    await apiDelete(`/api/projects/${id}`);
    const r = await apiGet<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
  };

  // Clicking a space in chat opens its studio view. Local → relative route on
  // the same origin; production → the lmthing.studio domain.
  const openSpaceInStudio = (spaceId: string) => {
    if (!activeProjectId) return;
    openUrl(`${crossAppOrigin('studio')}/studio/${encodeURIComponent(activeProjectId)}/${encodeURIComponent(spaceId)}`);
  };

  const footer = <SurfaceSwitcher current="chat" onSwitch={onSwitchSurface} badges={surfaceBadges} bordered />;

  return (
    <AppSidebar
      className={className}
      width={width}
      height={height}
      storageKey="chat-sidebar"
      collapsible={collapsible}
      spacesDefaultExpanded={false}
      projects={projects}
      activeProjectId={activeProjectId}
      onSelectProject={id => nav.openProject(id)}
      onCreateProject={createProject}
      onDeleteProject={deleteProject}
      onProjectSettings={
        activeProject && onProjectSettings
          ? () => onProjectSettings(activeProject.id, activeProject.name)
          : undefined
      }
      spaces={spaces}
      onSelectSpace={openSpaceInStudio}
      spacesLoading={spacesLoading}
      appPages={appPages}
      onOpenAppPage={
        activeProject && onOpenAppPage
          ? (routePath) => onOpenAppPage({ id: activeProject.id, name: activeProject.name }, routePath)
          : undefined
      }
      footer={footer}
    />
  );
}

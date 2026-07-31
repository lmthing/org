import * as Prim from '../../elements/primitives/index';
import React from 'react';
import { cn } from '../lib/cn';
import { useStore } from '../store/store';
import type { Project, ModelPricing } from '../store/store';
import { apiGet, apiPost, apiDelete } from './api';
import { closeActiveSession, resumeSession as resumeLiveSession, startSession } from './session-control';
import { AppSidebar } from '../../elements/nav/app-sidebar';
import { SurfaceSwitcher, type Surface } from '../../elements/nav/surface-switcher';
import { crossAppOrigin } from '../../lib/app-urls';
import { openUrl } from '../../platform/navigation';

interface PersistedSessionMeta {
  sessionId: string; projectId?: string; agentSlug: string; spaceDir: string;
  title?: string; createdAt?: number; lastActivity: number; messageCount?: number; status: string;
  totalCostUsd?: number;
}

interface SpaceMeta { id: string; name: string }

function formatCost(usd: number): string {
  if (usd < 0.000001) return '';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function groupSessionsByRecency(sessions: PersistedSessionMeta[]) {
  const now = Date.now();
  const groups: { label: string; sessions: PersistedSessionMeta[] }[] = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'Last 7 days', sessions: [] },
    { label: 'Older', sessions: [] },
  ];
  for (const s of sessions) {
    const diff = now - s.lastActivity;
    if (diff < 86_400_000) groups[0].sessions.push(s);
    else if (diff < 172_800_000) groups[1].sessions.push(s);
    else if (diff < 604_800_000) groups[2].sessions.push(s);
    else groups[3].sessions.push(s);
  }
  return groups.filter(g => g.sessions.length > 0);
}

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
}

/** `.bg-muted text-foreground font-medium` / the idle row's hover pair, as prop bags. */
const SESSION_ACTIVE = { backgroundColor: '$muted', color: '$foreground', fontWeight: '$medium' } as const;
const SESSION_IDLE = {
  color: '$muted-foreground',
  hoverStyle: {
    backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)',
    color: '$foreground',
  },
} as const;

export function Sidebar({ onProjectSettings, className, width, height, collapsible = true, onSwitchSurface, surfaceBadges }: SidebarProps) {
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeSessionId = useStore(s => s.activeSessionId);
  const sessionTitle = useStore(s => s.sessionTitle);
  const setProjects = useStore(s => s.setProjects);
  const setActiveProjectId = useStore(s => s.setActiveProjectId);
  const sessionCostUsd = useStore(s => s.sessionCostUsd);
  const setPrices = useStore(s => s.setPrices);

  const [sessions, setSessions] = React.useState<PersistedSessionMeta[]>([]);
  const [spaces, setSpaces] = React.useState<SpaceMeta[]>([]);
  const [spacesLoading, setSpacesLoading] = React.useState(false);
  const [creatingSession, setCreatingSession] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');

  const loadSessions = React.useCallback((projectId: string) => {
    apiGet<{ sessions: PersistedSessionMeta[] }>(`/api/projects/${projectId}/sessions`)
      .then(r => setSessions(r.sessions)).catch(() => setSessions([]));
  }, []);

  const loadSpaces = React.useCallback((projectId: string) => {
    setSpacesLoading(true);
    apiGet<{ spaces: SpaceMeta[] }>(`/api/projects/${projectId}/spaces`)
      .then(r => setSpaces(r.spaces ?? []))
      .catch(() => setSpaces([]))
      .finally(() => setSpacesLoading(false));
  }, []);

  React.useEffect(() => {
    apiGet<{ projects: Project[] }>('/api/projects')
      .then(r => {
        setProjects(r.projects);
        // Auto-select a default project if none is active yet (fallback for when
        // the main.tsx boot fetch fails or runs before the store is ready).
        if (!useStore.getState().activeProjectId && r.projects.length > 0) {
          const defaultProject = r.projects.find(p => p.id === 'user') ?? r.projects[0];
          setActiveProjectId(defaultProject.id);
        }
      })
      .catch(() => {});
  }, [setProjects, setActiveProjectId]);

  React.useEffect(() => {
    apiGet<Record<string, ModelPricing>>('/api/prices/azure')
      .then(setPrices).catch(() => {});
  }, [setPrices]);

  React.useEffect(() => {
    if (activeProjectId) { loadSessions(activeProjectId); loadSpaces(activeProjectId); }
    else { setSessions([]); setSpaces([]); }
  }, [activeProjectId, loadSessions, loadSpaces]);

  const activeProject = projects.find(p => p.id === activeProjectId);

  const createProject = async (name: string) => {
    await apiPost<{ id: string }>('/api/projects', { name });
    const r = await apiGet<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
    const created = r.projects.find(p => p.name === name);
    if (created) setActiveProjectId(created.id);
  };

  const deleteProject = async (id: string) => {
    await apiDelete(`/api/projects/${id}`);
    const r = await apiGet<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
    if (activeProjectId === id) setActiveProjectId(r.projects[0]?.id ?? null);
  };

  const createSession = async () => {
    if (!activeProjectId) return;
    setCreatingSession(true);
    try {
      await startSession(activeProjectId);
      loadSessions(activeProjectId);
    } finally { setCreatingSession(false); }
  };

  const resumeSession = async (sessionId: string) => {
    if (!activeProjectId) return;
    await resumeLiveSession(activeProjectId, sessionId);
    loadSessions(activeProjectId);
  };

  const deleteSession = async (sessionId: string) => {
    await apiDelete(`/api/sessions/${sessionId}`);
    if (activeProjectId) loadSessions(activeProjectId);
    if (activeSessionId === sessionId) {
      useStore.getState().setActiveSessionId(null);
      closeActiveSession();
    }
  };

  // Clicking a space in chat opens its studio view. Local → relative route on
  // the same origin; production → the lmthing.studio domain.
  const openSpaceInStudio = (spaceId: string) => {
    if (!activeProjectId) return;
    openUrl(`${crossAppOrigin('studio')}/studio/${encodeURIComponent(activeProjectId)}/${encodeURIComponent(spaceId)}`);
  };

  const filteredSessions = searchQuery
    ? sessions.filter(s => (s.title || s.agentSlug || s.sessionId).toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  const grouped = groupSessionsByRecency(filteredSessions);

  const conversations = (
    <Prim.Col gap="$2">
      <Prim.TextField
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="Search chats…"
        width="100%" backgroundColor="$muted" borderWidth={0} borderRadius="$radius-lg" paddingHorizontal="$3" paddingVertical="$1.5" fontSize="$sm" color="$foreground" placeholderTextColor="$muted-foreground" focusStyle={{ outlineWidth: 1, outlineStyle: "solid", outlineColor: "$ring" }}
      />
      {grouped.length === 0 && activeProjectId && (
        <Prim.Text as="p" paddingHorizontal="$2" fontSize="$sm" color="$muted-foreground">No chats yet.</Prim.Text>
      )}
      {grouped.map(group => (
        <Prim.Box key={group.label}>
          <Prim.Text as="p" paddingHorizontal="$2" paddingVertical="$0.5" fontSize="$xs" fontWeight="$semibold" color="$muted-foreground" textTransform="uppercase" letterSpacing="$wider">{group.label}</Prim.Text>
          {group.sessions.map(s => {
            const isActive = s.sessionId === activeSessionId;
            // The active session's title can change live (agent setSessionMeta) before
            // the persisted list refetches — prefer the live store title for that row.
            const displayTitle = (isActive && sessionTitle) || s.title;
            const label = displayTitle || 'New chat';
            const cost = isActive ? sessionCostUsd : s.totalCostUsd;
            const costLabel = cost !== undefined && cost > 0 ? formatCost(cost) : '';
            return (
              <Prim.Row key={s.sessionId} {...({ group: true } as Record<string, unknown>)} gap="$1" alignItems="center">
                <Prim.Pressable
                  onClick={() => void resumeSession(s.sessionId)}
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                  {...(isActive ? SESSION_ACTIVE : SESSION_IDLE)} transition="quick" animateOnly={["color", "background-color", "border-color"]} flexGrow={1} flexShrink={1} flexBasis="0%" textAlign="left" paddingHorizontal="$2" paddingVertical="$1.5" borderRadius="$radius-lg" fontSize="$sm"
                  title={displayTitle || s.sessionId}
                >
                  <Prim.Text display="block" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{label}</Prim.Text>
                  <Prim.Text color="color-mix(in srgb, var(--muted-foreground) 70%, transparent)" fontSize="$xs" fontWeight="$normal" display="block">
                    {relativeTime(s.lastActivity)}
                    {costLabel && <Prim.Text color="color-mix(in srgb, var(--muted-foreground) 50%, transparent)" marginLeft="0.375rem">{costLabel}</Prim.Text>}
                  </Prim.Text>
                </Prim.Pressable>
                {/* `display="none"` + `$group-hover` used to gate this on a mouse hover — a
                    web-only Tamagui affordance (`$group-hover` has no native fork at all, so
                    on a phone this button was permanently absent) and, even on web, unreachable
                    without a pointer that can hover, i.e. on touch. A session could not be
                    deleted at all from a phone. Always rendered now; `$md` shrinks the touch
                    target back down once a mouse (and hover) is available, matching the
                    Composer's touch-target sizing. */}
                <Prim.Pressable
                  onClick={() => void deleteSession(s.sessionId)}
                  width="$11" height="$11" $md={{ width: "$5", height: "$5" }} alignItems="center" justifyContent="center" color="$muted-foreground" borderRadius="$radius" fontSize="$xs" flexShrink={0} hoverStyle={{ color: "$destructive" }}
                  title="Delete"
                  aria-label="Delete conversation"
                ><Prim.Text>×</Prim.Text></Prim.Pressable>
              </Prim.Row>
            );
          })}
        </Prim.Box>
      ))}
    </Prim.Col>
  );

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
      onSelectProject={setActiveProjectId}
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
      onNewChat={() => void createSession()}
      newChatBusy={creatingSession}
      conversations={conversations}
      footer={footer}
    />
  );
}

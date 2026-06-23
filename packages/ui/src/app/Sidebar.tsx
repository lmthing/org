import React from 'react';
import { cn } from '../lib/cn.js';
import { useStore, connectLive } from '../store/store.js';
import type { Project, ModelPricing } from '../store/store.js';

interface PersistedSessionMeta {
  sessionId: string; projectId?: string; agentSlug: string; spaceDir: string;
  title?: string; createdAt?: number; lastActivity: number; messageCount?: number; status: string;
  totalCostUsd?: number;
}

function formatCost(usd: number): string {
  if (usd < 0.000001) return '';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path); if (!r.ok) throw new Error(`GET ${path} → ${r.status}`); return r.json() as Promise<T>;
}
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`); return r.json() as Promise<T>;
}
async function apiDelete(path: string): Promise<void> {
  const r = await fetch(path, { method: 'DELETE' }); if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
}

let activeConn: ReturnType<typeof connectLive> | null = null;

function switchSession(sessionId: string): void {
  if (activeConn) { activeConn.close(); activeConn = null; }
  useStore.getState().resetSession();
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  activeConn = connectLive(`${proto}//${window.location.host}/api/ws?sessionId=${encodeURIComponent(sessionId)}`);
  (window as unknown as { __LM_SEND__?: (m: unknown) => void }).__LM_SEND__ = activeConn.send;
  useStore.getState().setActiveSessionId(sessionId);
  // On mobile the sidebar is an overlay drawer — close it so the conversation shows.
  if (window.innerWidth < 768) useStore.getState().setSidebarOpen(false);
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
}

export function Sidebar({ onProjectSettings, className }: SidebarProps) {
  const projects = useStore(s => s.projects);
  const activeProjectId = useStore(s => s.activeProjectId);
  const activeSessionId = useStore(s => s.activeSessionId);
  const setProjects = useStore(s => s.setProjects);
  const setActiveProjectId = useStore(s => s.setActiveProjectId);
  const sessionCostUsd = useStore(s => s.sessionCostUsd);
  const setPrices = useStore(s => s.setPrices);

  const [sessions, setSessions] = React.useState<PersistedSessionMeta[]>([]);
  const [newProjectName, setNewProjectName] = React.useState('');
  const [creatingProject, setCreatingProject] = React.useState(false);
  const [creatingSession, setCreatingSession] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');

  const loadSessions = React.useCallback((projectId: string) => {
    apiGet<{ sessions: PersistedSessionMeta[] }>(`/api/projects/${projectId}/sessions`)
      .then(r => setSessions(r.sessions)).catch(() => setSessions([]));
  }, []);

  React.useEffect(() => {
    apiGet<{ projects: Project[] }>('/api/projects')
      .then(r => setProjects(r.projects)).catch(() => {});
  }, [setProjects]);

  React.useEffect(() => {
    apiGet<Record<string, ModelPricing>>('/api/prices/azure')
      .then(setPrices).catch(() => {});
  }, [setPrices]);

  React.useEffect(() => {
    if (activeProjectId) loadSessions(activeProjectId); else setSessions([]);
  }, [activeProjectId, loadSessions]);

  const activeProject = projects.find(p => p.id === activeProjectId);

  const createProject = async () => {
    const name = newProjectName.trim(); if (!name) return;
    setCreatingProject(true);
    try {
      await apiPost<{ id: string }>('/api/projects', { name });
      const r = await apiGet<{ projects: Project[] }>('/api/projects');
      setProjects(r.projects);
      const created = r.projects.find(p => p.name === name);
      if (created) setActiveProjectId(created.id);
      setNewProjectName('');
    } finally { setCreatingProject(false); }
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
      const { sessionId } = await apiPost<{ sessionId: string }>('/api/sessions', { projectId: activeProjectId });
      switchSession(sessionId);
      loadSessions(activeProjectId);
    } finally { setCreatingSession(false); }
  };

  const resumeSession = async (sessionId: string) => {
    if (!activeProjectId) return;
    const { sessionId: sid } = await apiPost<{ sessionId: string }>('/api/sessions', { projectId: activeProjectId, resumeSessionId: sessionId });
    switchSession(sid);
    loadSessions(activeProjectId);
  };

  const deleteSession = async (sessionId: string) => {
    await apiDelete(`/api/sessions/${sessionId}`);
    if (activeProjectId) loadSessions(activeProjectId);
    if (activeSessionId === sessionId) {
      useStore.getState().setActiveSessionId(null);
      if (activeConn) { activeConn.close(); activeConn = null; }
    }
  };

  const filteredSessions = searchQuery
    ? sessions.filter(s => (s.title || s.agentSlug || s.sessionId).toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;

  const grouped = groupSessionsByRecency(filteredSessions);

  return (
    <nav
      aria-label="projects and sessions"
      className={cn('flex flex-col h-full bg-sidebar border-r border-sidebar-border overflow-hidden', className)}
    >
      {/* Logo / brand */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-sidebar-border shrink-0">
        <span className="font-display font-bold text-base text-foreground">THING</span>
        <span className="text-xs text-muted-foreground">by lmthing</span>
      </div>

      {/* New chat + search */}
      <div className="px-3 py-2 flex flex-col gap-2 shrink-0">
        <button
          onClick={() => void createSession()}
          disabled={!activeProjectId || creatingSession}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {creatingSession ? '…' : '+ New chat'}
        </button>
        <div className="relative">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full bg-muted border-0 rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {/* Project selector */}
        <div className="mb-3">
          <p className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Projects</p>
          {projects.map(p => (
            <div key={p.id} className="group flex items-center gap-1">
              <button
                onClick={() => setActiveProjectId(p.id)}
                className={cn(
                  'flex-1 text-left px-2 py-1.5 rounded-lg text-sm truncate transition-colors',
                  activeProjectId === p.id
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {p.name}
              </button>
              <button
                onClick={() => void deleteProject(p.id)}
                className="hidden group-hover:flex w-5 h-5 items-center justify-center text-muted-foreground hover:text-destructive rounded text-xs shrink-0"
                title="Delete project"
              >×</button>
            </div>
          ))}
          <div className="flex gap-1 mt-1">
            <input
              className="flex-1 min-w-0 bg-muted rounded-lg px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="New project…"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createProject(); }}
            />
            <button
              onClick={() => void createProject()}
              disabled={creatingProject || !newProjectName.trim()}
              className="px-2 py-1 bg-muted text-foreground rounded-lg text-xs hover:opacity-90 disabled:opacity-40"
            >+</button>
          </div>
        </div>

        {/* Session list grouped by recency */}
        {grouped.length === 0 && activeProjectId && (
          <p className="px-2 text-sm text-muted-foreground">No chats yet.</p>
        )}
        {grouped.map(group => (
          <div key={group.label} className="mb-3">
            <p className="px-2 py-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.label}</p>
            {group.sessions.map(s => {
              const label = s.title || 'New chat';
              const isActive = s.sessionId === activeSessionId;
              const cost = isActive ? sessionCostUsd : s.totalCostUsd;
              const costLabel = cost !== undefined && cost > 0 ? formatCost(cost) : '';
              return (
                <div key={s.sessionId} className="group flex items-center gap-1">
                  <button
                    onClick={() => void resumeSession(s.sessionId)}
                    className={cn(
                      'flex-1 text-left px-2 py-1.5 rounded-lg text-sm truncate transition-colors',
                      isActive
                        ? 'bg-muted text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                    title={s.title || s.sessionId}
                  >
                    <span className="block truncate">{label}</span>
                    <span className="block text-xs text-muted-foreground/70 font-normal">
                      {relativeTime(s.lastActivity)}
                      {costLabel && <span className="ml-1.5 text-muted-foreground/50">{costLabel}</span>}
                    </span>
                  </button>
                  <button
                    onClick={() => void deleteSession(s.sessionId)}
                    className="hidden group-hover:flex w-5 h-5 items-center justify-center text-muted-foreground hover:text-destructive rounded text-xs shrink-0"
                    title="Delete"
                  >×</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-sidebar-border px-3 py-2 flex items-center gap-2">
        {activeProject && onProjectSettings && (
          <button
            onClick={() => onProjectSettings(activeProject.id, activeProject.name)}
            className="flex-1 text-left text-xs text-muted-foreground hover:text-foreground truncate"
          >
            ⚙ {activeProject.name}
          </button>
        )}
      </div>
    </nav>
  );
}

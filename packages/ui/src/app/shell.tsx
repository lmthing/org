/**
 * Shell — project + session management sidebar wrapping the existing 3-pane App.
 *
 * Layout:
 *   [sidebar: projects → sessions] | [main: App (3-pane observability)]
 *
 * WS reconnect strategy:
 *   Each time activeSessionId changes, Shell calls connectLive() with the new
 *   sessionId's WS URL, closes the previous connection handle, and resets the
 *   store model so the new session starts clean.
 */
import React from 'react';
import { App } from './App.js';
import { useStore, connectLive, type Project, type SessionMeta } from '../store/store.js';

// ─── API helpers ─────────────────────────────────────────────────────────────

const BASE = '';  // same-origin

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPut(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
}

async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
}

// ─── WS connection management ─────────────────────────────────────────────────

// Module-level handle so we can close the previous connection when switching.
let activeConn: { send: (m: unknown) => void; close: () => void } | null = null;

function switchSession(sessionId: string): void {
  // Close previous connection.
  if (activeConn) { activeConn.close(); activeConn = null; }

  // Reset the store model so stale events from the previous session don't show.
  useStore.getState().resetSession();

  // Build the WS URL — same origin, per-session endpoint.
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/api/ws?sessionId=${encodeURIComponent(sessionId)}`;
  activeConn = connectLive(wsUrl);

  // Expose send handle for MessageInput (conversation.tsx reads __LM_SEND__).
  const w = window as unknown as { __LM_SEND__?: (m: unknown) => void };
  w.__LM_SEND__ = activeConn.send;

  useStore.getState().setActiveSessionId(sessionId);
}

// ─── Project instructions panel ──────────────────────────────────────────────

function InstructionsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [content, setContent] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    setLoaded(false);
    apiGet<{ content: string }>(`/api/projects/${projectId}/instructions`)
      .then((r) => { setContent(r.content); setLoaded(true); })
      .catch(() => { setContent(''); setLoaded(true); });
  }, [projectId]);

  const save = async () => {
    setSaving(true);
    try { await apiPut(`/api/projects/${projectId}/instructions`, { content }); }
    finally { setSaving(false); }
  };

  if (!loaded) return <div className="text-lm-muted text-[11px] px-1 py-2">Loading…</div>;

  return (
    <div className="flex flex-col gap-1">
      <textarea
        className="w-full bg-lm-bg border border-lm-border rounded px-2 py-1 text-lm-text text-[11px] font-mono resize-none"
        rows={5}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Project instructions…"
      />
      <button
        onClick={() => void save()}
        disabled={saving}
        className="self-end px-2 py-0.5 bg-lm-accent/20 text-lm-accent rounded text-[11px] disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// ─── Documents panel ──────────────────────────────────────────────────────────

function DocumentsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const [docs, setDocs] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const reload = () => {
    apiGet<{ documents: string[] }>(`/api/projects/${projectId}/documents`)
      .then((r) => setDocs(r.documents))
      .catch(() => setDocs([]));
  };

  React.useEffect(() => { reload(); }, [projectId]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const content = await file.text();
      await apiPost(`/api/projects/${projectId}/documents`, { name: file.name, content });
      reload();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {docs.length === 0 && <div className="text-lm-muted text-[11px]">No documents.</div>}
      {docs.map((d) => (
        <div key={d} className="text-[11px] text-lm-text font-mono truncate" title={d}>📄 {d}</div>
      ))}
      <label className={`mt-1 self-start px-2 py-0.5 bg-lm-panel2 border border-lm-border rounded text-[11px] text-lm-muted cursor-pointer hover:text-lm-text ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
        {uploading ? 'Uploading…' : '+ Upload file'}
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => void handleFile(e)} />
      </label>
    </div>
  );
}

// ─── Project detail (collapsible) ────────────────────────────────────────────

function ProjectDetail({ projectId }: { projectId: string }): React.ReactElement {
  const [instrOpen, setInstrOpen] = React.useState(true);
  const [docsOpen, setDocsOpen] = React.useState(false);

  return (
    <div className="border-t border-lm-border pt-2 mt-2 flex flex-col gap-2">
      {/* Instructions section */}
      <div>
        <button
          onClick={() => setInstrOpen((o) => !o)}
          className="flex items-center gap-1 text-[11px] text-lm-muted hover:text-lm-text w-full text-left"
        >
          <span>{instrOpen ? '▾' : '▸'}</span>
          <span className="font-semibold">Instructions</span>
        </button>
        {instrOpen && (
          <div className="mt-1">
            <InstructionsPanel projectId={projectId} />
          </div>
        )}
      </div>

      {/* Documents section */}
      <div>
        <button
          onClick={() => setDocsOpen((o) => !o)}
          className="flex items-center gap-1 text-[11px] text-lm-muted hover:text-lm-text w-full text-left"
        >
          <span>{docsOpen ? '▾' : '▸'}</span>
          <span className="font-semibold">Documents</span>
        </button>
        {docsOpen && (
          <div className="mt-1">
            <DocumentsPanel projectId={projectId} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Session list item ────────────────────────────────────────────────────────

function SessionItem({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const label = session.agentSlug || session.sessionId.slice(0, 8);
  const ts = session.lastActivity
    ? new Date(session.lastActivity).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-[11px] group ${
        active ? 'bg-lm-accent/15 text-lm-accent' : 'text-lm-text hover:bg-lm-panel2'
      }`}
      onClick={onSelect}
    >
      <span className="flex-1 truncate font-mono" title={session.sessionId}>{label}</span>
      {ts && <span className="text-lm-muted shrink-0">{ts}</span>}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="hidden group-hover:block text-lm-muted hover:text-lm-red ml-1 shrink-0"
        title="Delete session"
      >×</button>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar(): React.ReactElement {
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const setProjects = useStore((s) => s.setProjects);
  const setActiveProjectId = useStore((s) => s.setActiveProjectId);
  const setSessions = useStore((s) => s.setSessions);

  const [newProjectName, setNewProjectName] = React.useState('');
  const [creatingProject, setCreatingProject] = React.useState(false);
  const [creatingSession, setCreatingSession] = React.useState(false);
  const [projectDetailOpen, setProjectDetailOpen] = React.useState(false);

  // Load sessions whenever the active project changes.
  const loadSessions = React.useCallback((projectId: string) => {
    apiGet<{ sessions: SessionMeta[] }>('/api/sessions')
      .then((r) => {
        // The server may return all sessions; we don't filter by projectId
        // because the contract says GET /api/sessions returns all. If the server
        // scopes by project in the future, this still works.
        setSessions(r.sessions);
      })
      .catch(() => setSessions([]));
  }, [setSessions]);

  // Reload projects on mount.
  React.useEffect(() => {
    apiGet<{ projects: Project[] }>('/api/projects')
      .then((r) => setProjects(r.projects))
      .catch(() => {/* no projects endpoint yet — ignore */});
  }, [setProjects]);

  // When active project changes, reload sessions.
  React.useEffect(() => {
    if (activeProjectId) loadSessions(activeProjectId);
    else setSessions([]);
  }, [activeProjectId, loadSessions, setSessions]);

  const selectProject = (id: string) => {
    setActiveProjectId(id);
    setProjectDetailOpen(false);
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    try {
      await apiPost<{ id: string }>('/api/projects', { name });
      const r = await apiGet<{ projects: Project[] }>('/api/projects');
      setProjects(r.projects);
      const created = r.projects.find((p) => p.name === name);
      if (created) selectProject(created.id);
      setNewProjectName('');
    } finally {
      setCreatingProject(false);
    }
  };

  const deleteProject = async (id: string) => {
    await apiDelete(`/api/projects/${id}`);
    const r = await apiGet<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
    if (activeProjectId === id) {
      setActiveProjectId(r.projects[0]?.id ?? null);
    }
  };

  const createSession = async () => {
    if (!activeProjectId) return;
    setCreatingSession(true);
    try {
      const { sessionId } = await apiPost<{ sessionId: string }>('/api/sessions', { projectId: activeProjectId });
      switchSession(sessionId);
      loadSessions(activeProjectId);
    } finally {
      setCreatingSession(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    await apiDelete(`/api/sessions/${sessionId}`);
    if (activeProjectId) loadSessions(activeProjectId);
    if (activeSessionId === sessionId) {
      useStore.getState().setActiveSessionId(null);
      if (activeConn) { activeConn.close(); activeConn = null; }
    }
  };

  return (
    <nav
      aria-label="projects and sessions"
      className="flex flex-col h-full overflow-y-auto bg-lm-panel border-r border-lm-border"
      style={{ width: 220 }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-lm-border shrink-0">
        <span className="font-semibold text-[12px] text-lm-text">Projects</span>
      </div>

      {/* Project list */}
      <div className="flex flex-col gap-0.5 px-2 py-2 shrink-0">
        {projects.map((p) => (
          <div key={p.id} className="group flex items-center gap-1">
            <button
              onClick={() => selectProject(p.id)}
              className={`flex-1 text-left truncate px-2 py-1 rounded text-[12px] ${
                activeProjectId === p.id
                  ? 'bg-lm-accent/15 text-lm-accent font-medium'
                  : 'text-lm-text hover:bg-lm-panel2'
              }`}
              title={p.name}
            >
              {p.name}
            </button>
            <button
              onClick={() => void deleteProject(p.id)}
              className="hidden group-hover:block text-lm-muted hover:text-lm-red text-[11px] px-1 shrink-0"
              title="Delete project"
            >×</button>
          </div>
        ))}
      </div>

      {/* New project form */}
      <div className="flex gap-1 px-2 pb-2 shrink-0">
        <input
          className="flex-1 min-w-0 bg-lm-bg border border-lm-border rounded px-2 py-1 text-[11px] text-lm-text placeholder:text-lm-muted"
          placeholder="New project…"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createProject(); }}
        />
        <button
          onClick={() => void createProject()}
          disabled={creatingProject || !newProjectName.trim()}
          className="px-2 py-1 bg-lm-accent/20 text-lm-accent rounded text-[11px] disabled:opacity-50 shrink-0"
        >+</button>
      </div>

      {/* Per-project content */}
      {activeProjectId && (
        <div className="flex flex-col gap-0 border-t border-lm-border pt-2 shrink-0">
          {/* Sessions header + new chat */}
          <div className="flex items-center gap-1 px-2 pb-1">
            <span className="text-[11px] text-lm-muted font-semibold flex-1">Chats</span>
            <button
              onClick={() => void createSession()}
              disabled={creatingSession}
              className="px-2 py-0.5 bg-lm-accent/20 text-lm-accent rounded text-[11px] disabled:opacity-50"
              title="New chat"
            >
              {creatingSession ? '…' : '+ New chat'}
            </button>
          </div>

          {/* Session list */}
          <div className="flex flex-col gap-0.5 px-1">
            {sessions.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-lm-muted">No chats yet.</div>
            )}
            {sessions.map((s) => (
              <SessionItem
                key={s.sessionId}
                session={s}
                active={s.sessionId === activeSessionId}
                onSelect={() => switchSession(s.sessionId)}
                onDelete={() => void deleteSession(s.sessionId)}
              />
            ))}
          </div>

          {/* Project detail toggle */}
          <button
            onClick={() => setProjectDetailOpen((o) => !o)}
            className="mx-2 mt-2 px-2 py-1 border border-lm-border rounded text-[11px] text-lm-muted hover:text-lm-text text-left"
          >
            {projectDetailOpen ? '▾ Project settings' : '▸ Project settings'}
          </button>

          {projectDetailOpen && (
            <div className="px-2 pb-2">
              <ProjectDetail projectId={activeProjectId} />
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

// ─── Empty state (no session selected) ────────────────────────────────────────

function EmptyState(): React.ReactElement {
  const activeProjectId = useStore((s) => s.activeProjectId);
  return (
    <div className="flex-1 flex items-center justify-center text-lm-muted text-[13px]">
      {activeProjectId
        ? 'Select or start a chat from the sidebar.'
        : 'Select or create a project to get started.'}
    </div>
  );
}

// ─── Shell root ───────────────────────────────────────────────────────────────

export function Shell(): React.ReactElement {
  const activeSessionId = useStore((s) => s.activeSessionId);

  return (
    <div className="h-full flex flex-row overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activeSessionId ? <App /> : <EmptyState />}
      </div>
    </div>
  );
}

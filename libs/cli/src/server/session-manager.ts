import { randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Session, saveSnapshot, loadSpace } from '@lmthing/core';
import type { StreamOpts, StreamSession, AppGlobalImpls } from '@lmthing/core';
import { bootProjectApp } from '../app/boot.js';
import type { ProjectDb } from '../app/store.js';
import { WebRenderHost } from '../rpc/server.js';
import { TraceHub } from '../rpc/trace-hub.js';
import {
  DEFAULT_PROJECT_ID,
  SYSTEM_PROJECT_ID,
  safeProjectId,
  slugify,
  scaffoldProject,
  readProjectMeta,
  listProjects,
  deleteProject,
  getInstructions,
  setInstructions,
  listDocuments,
  addDocument,
  listSystemSpaceDirs,
  listProjectSpaceDirs,
  ensureDefaultProject,
  safeDocumentName,
  sessionsDir,
  listProjectSessions,
  projectSpaceDir,
  readSpaceFiles,
  writeSpaceFiles,
  writeProjectSpaceFile as writeSpaceFile,
  deleteProjectSpaceFile as deleteSpaceFile,
} from './projects.js';
import type { ProjectMeta, PersistedSessionMeta } from './projects.js';

export type SessionStatus = 'idle' | 'running' | 'error';

/** Lightweight descriptor for a space created under a project, surfaced in the
 *  web UI. Derived from the space's package.json + agent instruct frontmatter. */
export interface SpaceMeta {
  /** Dir basename — the stable id within the project's spaces/ tree. */
  id: string;
  /** Display name: first agent's title, else package name, else id. */
  name: string;
  /** One-line description (first non-heading line of the first agent's instruct body). */
  description: string;
  agents: { slug: string; title: string; actions: { id: string; label: string }[] }[];
  functionCount: number;
  componentCount: number;
  hasKnowledge: boolean;
}

/** One live multi-session entry: the Session plus its OWN renderHost + hub so
 *  events never cross sessions. */
export interface SessionEntry {
  sessionId: string;
  session: Session;
  renderHost: WebRenderHost;
  hub: TraceHub;
  spaceDir: string;
  agentSlug: string;
  lastActivity: number;
  started: boolean;
  status: SessionStatus;
  /** Project id (project-mode only). */
  projectId?: string;
  /** Human-readable title set from the first user message, or overridden by the
   *  agent via setSessionMeta(). */
  title?: string;
  /** URL-safe handle for the session, set by the agent via setSessionMeta(). */
  slug?: string;
  /** Epoch ms when this entry was created. */
  createdAt: number;
  /** Number of user messages sent so far. */
  messageCount: number;
  /** When true, the next sendMessage should call resume() instead of start(). */
  needsResume?: boolean;
  /** Absolute path to the session's persistence dir (project-mode only). */
  snapshotDir?: string;
  /** Accumulated LLM cost in USD across all turns in this session. */
  totalCostUsd: number;
}

/** Lightweight metadata for listSessions() — never exposes the Session object. */
export interface SessionMeta {
  sessionId: string;
  spaceDir: string;
  agentSlug: string;
  lastActivity: number;
  started: boolean;
  status: SessionStatus;
}

/** Parameters for spinning up one session's wiring (mirrors bin.ts web branch). */
export interface BuildSessionArgs {
  spaceDir: string;
  agentSlug: string;
  /** Project id + absolute project root (`<root>/<projectId>`), set in project mode so the
   *  session's app globals resolve against the project. */
  projectId?: string;
  projectRoot?: string;
  /** The project's booted app-global impls (db store, …). Injected into the session VM +
   *  its forks/delegates when the agent holds the matching capability grants. */
  appGlobals?: AppGlobalImpls;
  model?: string;
  budget?: {
    maxEpisodes?: number;
    maxToolCalls?: number;
    maxForkDepth?: number;
    maxWallClockMs?: number;
  };
  renderHost: WebRenderHost;
  /** Override the always-loaded system space dirs (absolute paths). */
  systemSpaceDirs?: string[];
  /** Absolute space dirs pre-loaded into dynamicSpaces at start. */
  preloadSpaceDirs?: string[];
  /** Absolute path to the project's spaces/ dir; exposed to VMs as env. */
  projectSpacesDir?: string;
}

/** Encapsulates the bin.ts wiring: construct a Session bound to the chosen
 *  streamFn. The manager owns the entry's hub and subscribes it to the returned
 *  session's tracer, so each session's events stay scoped to its own hub. */
export type BuildSession = (args: BuildSessionArgs) => Session;

export interface SessionManagerOpts {
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  defaultSpaceDir?: string;
  maxSessions?: number;
  snapshotsDir?: string;
  idleTtlMs?: number;
  /** Encapsulates the bin.ts wiring (construct Session bound to a streamFn). The
   *  manager pairs each session with its OWN WebRenderHost + TraceHub. When
   *  omitted, a default builder using `streamFn` is used. */
  buildSession?: BuildSession;
  /** Absolute path to `<cwd>/.lmthing`. When set, the manager resolves project
   *  directories from this root and exposes project CRUD methods. */
  lmthingRoot?: string;
  /** Resolved default model spec (e.g. "azure:DeepSeek-V4-Flash") used when a
   *  session is created without an explicit model override. Forwarded as
   *  `modelAlias` so llm_request/llm_response events carry a model field for
   *  cost tracking. */
  defaultModelAlias?: string;
}

interface ModelPricing { inputPer1K: number; outputPer1K: number }

function loadAzurePrices(): Record<string, ModelPricing> {
  try {
    const pricesPath = join(dirname(fileURLToPath(import.meta.url)), '../prices/azure.json');
    return JSON.parse(readFileSync(pricesPath, 'utf8')) as Record<string, ModelPricing>;
  } catch {
    return {};
  }
}

function computeTurnCost(
  prices: Record<string, ModelPricing>,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!model) return 0;
  const modelId = model.includes(':') ? model.split(':').slice(1).join(':') : model;
  const p = prices[modelId];
  if (!p) return 0;
  return (inputTokens / 1000) * p.inputPer1K + (outputTokens / 1000) * p.outputPer1K;
}

/**
 * Owns a pool of independent agent sessions. Each session gets its OWN
 * WebRenderHost + TraceHub so display/ask/trace events never cross sessions.
 */
export class SessionManager {
  private sessions: Map<string, SessionEntry> = new Map();
  private streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  private defaultSpaceDir?: string;
  private defaultModelAlias?: string;
  readonly maxSessions: number;
  readonly snapshotsDir: string;
  readonly idleTtlMs: number;
  private buildSessionFn: BuildSession;
  private reaper: ReturnType<typeof setInterval> | null = null;
  /** Absolute path to `<cwd>/.lmthing` — set when running in project mode. */
  readonly lmthingRoot?: string;
  /** Per-model pricing loaded from prices/azure.json at startup. */
  private prices: Record<string, ModelPricing> = loadAzurePrices();

  constructor(opts: SessionManagerOpts) {
    this.streamFn = opts.streamFn;
    this.defaultSpaceDir = opts.defaultSpaceDir;
    this.defaultModelAlias = opts.defaultModelAlias;
    this.maxSessions = opts.maxSessions ?? (Number(process.env['MAX_SESSIONS']) || 8);
    this.snapshotsDir = opts.snapshotsDir ?? process.env['SNAPSHOTS_DIR'] ?? '/data/snapshots';
    this.idleTtlMs = opts.idleTtlMs ?? Number(process.env['IDLE_TTL_MINUTES'] ?? 15) * 60000;
    this.buildSessionFn = opts.buildSession ?? this.defaultBuildSession.bind(this);
    this.lmthingRoot = opts.lmthingRoot;
  }

  /** Subscribe a session's tracer to its hub AND cost accumulation. */
  private wireTracer(session: Session, entry: SessionEntry): void {
    if (typeof session.getTracer !== 'function') return;
    session.getTracer().subscribe((e) => {
      entry.hub.push(e);
      if (
        e.type === 'llm_response' &&
        typeof e.inputTokens === 'number' &&
        typeof e.outputTokens === 'number'
      ) {
        entry.totalCostUsd += computeTurnCost(this.prices, e.model, e.inputTokens, e.outputTokens);
      }
      // The agent named the session via setSessionMeta(): adopt the title/slug and
      // persist so it survives eviction/restart and surfaces in the sessions list.
      if (e.type === 'session_meta') {
        if (e.title) entry.title = e.title;
        if (e.slug) entry.slug = e.slug;
        void this.persistSession(entry);
      }
    });
  }

  /** Default session builder — constructs a Session bound to `streamFn`. */
  private defaultBuildSession(args: BuildSessionArgs): Session {
    return new Session(
      {
        spaceDir: args.spaceDir,
        agentSlug: args.agentSlug,
        modelAlias: args.model ?? this.defaultModelAlias ?? 'default',
        renderHost: args.renderHost,
        budget: args.budget,
        maxHistoryTurns: 20,
        systemSpaceDirs: args.systemSpaceDirs,
        preloadSpaceDirs: args.preloadSpaceDirs,
        projectSpacesDir: args.projectSpacesDir,
        projectId: args.projectId,
        projectRoot: args.projectRoot,
        appGlobals: args.appGlobals,
      },
      { streamFn: this.streamFn },
    );
  }

  /** Per-project app-db cache. Lazily boots (restore→open→reconcile, fail-loud on
   *  non-additive schema drift) on first use and reuses the handle across sessions in
   *  that project; `null` is cached for spaces-only projects (e.g. `system`) so we don't
   *  re-probe every session. Closed in {@link closeProjectDbs} on shutdown. */
  private projectDbs = new Map<string, ProjectDb | null>();

  private async getProjectAppGlobals(root: string, projectId: string): Promise<AppGlobalImpls | undefined> {
    let db: ProjectDb | null | undefined = this.projectDbs.get(projectId);
    if (db === undefined) {
      db = await bootProjectApp(join(root, projectId));
      this.projectDbs.set(projectId, db);
    }
    return db ? { db: db.db } : undefined;
  }

  /** Close all cached project db handles (call on server shutdown). */
  closeProjectDbs(): void {
    for (const db of this.projectDbs.values()) {
      try { db?.close(); } catch { /* best-effort */ }
    }
    this.projectDbs.clear();
  }

  /**
   * Ensure there is room for one more live session, evicting if necessary.
   *
   * `maxSessions` bounds how many sessions can be resident in memory (each is a
   * QuickJS VM). Rather than refuse a new/resumed session when full — which made
   * "+ New chat" silently fail once a user had a few chats open — evict the
   * least-recently-active session that isn't currently running. Evicted sessions
   * are persisted to disk first, so they resume transparently when reopened.
   *
   * Returns true if there is now room; false only when every resident session is
   * actively running (nothing safe to evict).
   */
  private ensureCapacity(): boolean {
    if (this.sessions.size < this.maxSessions) return true;

    let victim: SessionEntry | undefined;
    for (const e of this.sessions.values()) {
      if (e.status === 'running') continue; // never evict an in-flight turn
      if (!victim || e.lastActivity < victim.lastActivity) victim = e;
    }
    if (!victim) return false;

    // Free the slot synchronously (so the immediate size check passes), then
    // persist + dispose in the background.
    const evicted = victim;
    this.sessions.delete(evicted.sessionId);
    console.warn(`[session-manager] evicted idle session ${evicted.sessionId} to free a slot (cap ${this.maxSessions})`);
    void (async () => {
      try { await this.persistSession(evicted); } catch { /* best-effort */ }
      try { evicted.session?.dispose(); } catch { /* best-effort */ }
    })();
    return true;
  }

  /**
   * Create a new session. When `lmthingRoot` is set, project-mode resolution is
   * used: `spaceDir` is derived from the project directory, `agentSlug` defaults
   * to `'thing'`, system spaces are read from `<root>/system/`, and synthesized
   * spaces in `<root>/<projectId>/spaces/` are pre-loaded into dynamicSpaces.
   *
   * When `lmthingRoot` is NOT set, the legacy behaviour applies: `spaceDir`
   * defaults to `defaultSpaceDir` and `agentSlug` defaults to `'default'`.
   */
  createSession(opts: {
    spaceDir?: string;
    agentSlug?: string;
    model?: string;
    budget?: BuildSessionArgs['budget'];
    /** Project id to use when running in project mode. Defaults to 'user'. */
    projectId?: string;
    /** Resume a previously saved session by id (project mode only). */
    resumeSessionId?: string;
  }): { sessionId: string } {
    // ── Resume path (project mode + resumeSessionId) ──────────────────────────
    if (this.lmthingRoot && opts.resumeSessionId) {
      const root = this.lmthingRoot;
      const projectId = opts.projectId ?? DEFAULT_PROJECT_ID;
      const resumeId = opts.resumeSessionId;

      // Validate id format.
      if (!safeProjectId(resumeId) && !/^[0-9a-f-]{36}$/.test(resumeId)) {
        throw new Error(`invalid resumeSessionId: ${resumeId}`);
      }

      // If already live, return it immediately.
      if (this.sessions.has(resumeId)) {
        return { sessionId: resumeId };
      }

      const snapshotDir = join(root, projectId, 'sessions', resumeId);
      const snapshotFile = join(snapshotDir, 'snapshot.json');

      if (!existsSync(snapshotFile)) {
        throw new Error(`no saved session found: ${resumeId}`);
      }

      if (!this.ensureCapacity()) {
        const msg = `max sessions reached (${this.maxSessions}) — all active sessions are busy`;
        console.warn(`[session-manager] ${msg}`);
        throw new Error(msg);
      }

      const renderHost = new WebRenderHost();
      const hub = new TraceHub();
      const now = Date.now();

      const placeholderEntry: SessionEntry = {
        sessionId: resumeId,
        session: null as unknown as Session,
        renderHost,
        hub,
        spaceDir: join(root, projectId),
        agentSlug: opts.agentSlug ?? 'thing',
        lastActivity: now,
        started: false,
        status: 'idle',
        projectId,
        createdAt: now,
        messageCount: 0,
        totalCostUsd: 0,
        needsResume: true,
        snapshotDir,
      };
      this.sessions.set(resumeId, placeholderEntry);

      // Async init: load meta + trace, then build session.
      void this._initResumedSession(placeholderEntry, root, projectId, opts, resumeId, snapshotDir).catch((err: unknown) => {
        placeholderEntry.status = 'error';
        renderHost.emit({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });

      return { sessionId: resumeId };
    }

    if (!this.ensureCapacity()) {
      const msg = `max sessions reached (${this.maxSessions}) — all active sessions are busy`;
      console.warn(`[session-manager] ${msg}`);
      throw new Error(msg);
    }

    // Project-mode resolution (async fields are resolved synchronously via a
    // deferred kick-off — actual async resolution happens in _createSessionAsync
    // but we keep createSession sync for API compat; callers use the sessionId
    // immediately and the session self-configures before first start()).
    // We spawn the async init and surface errors through the renderHost.
    const sessionId = randomUUID();
    const renderHost = new WebRenderHost();
    const hub = new TraceHub();

    if (this.lmthingRoot) {
      const root = this.lmthingRoot;
      const projectId = opts.projectId ?? DEFAULT_PROJECT_ID;
      const snapshotDir = join(root, projectId, 'sessions', sessionId);

      // Placeholder entry so callers can look up the session immediately.
      const placeholderEntry: SessionEntry = {
        sessionId,
        session: null as unknown as Session, // filled in by async init
        renderHost,
        hub,
        spaceDir: join(root, projectId),
        agentSlug: opts.agentSlug ?? 'thing',
        lastActivity: Date.now(),
        started: false,
        status: 'idle',
        projectId,
        createdAt: Date.now(),
        messageCount: 0,
        totalCostUsd: 0,
        snapshotDir,
      };
      this.sessions.set(sessionId, placeholderEntry);

      // Async init: resolve dirs then build the session.
      void this._initProjectSession(placeholderEntry, root, projectId, opts).catch((err: unknown) => {
        placeholderEntry.status = 'error';
        renderHost.emit({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });

      return { sessionId };
    }

    // Legacy path: spaceDir from opts or defaultSpaceDir.
    const spaceDir = opts.spaceDir ?? this.defaultSpaceDir;
    if (!spaceDir) {
      throw new Error('no spaceDir provided and no defaultSpaceDir configured');
    }
    const agentSlug = opts.agentSlug ?? 'default';

    const session = this.buildSessionFn({
      spaceDir,
      agentSlug,
      model: opts.model,
      budget: opts.budget,
      renderHost,
    });

    const entry: SessionEntry = {
      sessionId,
      session,
      renderHost,
      hub,
      spaceDir,
      agentSlug,
      lastActivity: Date.now(),
      started: false,
      status: 'idle',
      createdAt: Date.now(),
      messageCount: 0,
      totalCostUsd: 0,
    };

    // Subscribe this session's tracer to its OWN hub so trace events stay scoped.
    this.wireTracer(session, entry);
    this.sessions.set(sessionId, entry);
    return { sessionId };
  }

  /** Async counterpart to the project-mode branch of createSession. Resolves
   *  system + project space dirs from disk, constructs the Session, and fills in
   *  the placeholder entry. Safe to call concurrently; each call operates on its
   *  own placeholder entry. */
  private async _initProjectSession(
    entry: SessionEntry,
    root: string,
    projectId: string,
    opts: {
      agentSlug?: string;
      model?: string;
      budget?: BuildSessionArgs['budget'];
    },
  ): Promise<void> {
    const spaceDir = join(root, projectId);
    const agentSlug = opts.agentSlug ?? 'thing';
    const projectSpacesDir = join(root, projectId, 'spaces');

    const [systemSpaceDirs, preloadSpaceDirs] = await Promise.all([
      listSystemSpaceDirs(root),
      listProjectSpaceDirs(root, projectId),
    ]);

    const appGlobals = await this.getProjectAppGlobals(root, projectId);
    const session = this.buildSessionFn({
      spaceDir,
      agentSlug,
      model: opts.model,
      budget: opts.budget,
      renderHost: entry.renderHost,
      systemSpaceDirs,
      preloadSpaceDirs,
      projectSpacesDir,
      projectId,
      projectRoot: join(root, projectId),
      appGlobals,
    });

    // Wire up the tracer to this session's hub + cost tracking.
    this.wireTracer(session, entry);

    // Fill in the placeholder — update mutable fields in-place so the Map entry
    // already visible to getSession() callers stays valid.
    entry.session = session;
    entry.spaceDir = spaceDir;
    entry.agentSlug = agentSlug;
  }

  /** Async init for resumed sessions. Loads meta + trace from disk, builds
   *  the session (same wiring as _initProjectSession), seeds the hub with
   *  persisted trace events, and marks entry.needsResume=true so sendMessage
   *  uses session.resume() on the first call. */
  private async _initResumedSession(
    entry: SessionEntry,
    root: string,
    projectId: string,
    opts: {
      agentSlug?: string;
      model?: string;
      budget?: BuildSessionArgs['budget'];
    },
    sessionId: string,
    snapshotDir: string,
  ): Promise<void> {
    const spaceDir = join(root, projectId);
    const projectSpacesDir = join(root, projectId, 'spaces');

    // Load persisted meta to restore title/createdAt/messageCount.
    const metaPath = join(snapshotDir, 'meta.json');
    try {
      const raw = await readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw) as PersistedSessionMeta;
      entry.title = meta.title || undefined;
      entry.slug = meta.slug || undefined;
      entry.createdAt = meta.createdAt;
      entry.messageCount = meta.messageCount;
      entry.agentSlug = meta.agentSlug || entry.agentSlug;
      if (meta.totalCostUsd !== undefined) entry.totalCostUsd = meta.totalCostUsd;
    } catch {
      // No meta — keep defaults set at placeholder creation.
    }

    const agentSlug = entry.agentSlug;

    const [systemSpaceDirs, preloadSpaceDirs] = await Promise.all([
      listSystemSpaceDirs(root),
      listProjectSpaceDirs(root, projectId),
    ]);

    const appGlobals = await this.getProjectAppGlobals(root, projectId);
    const session = this.buildSessionFn({
      spaceDir,
      agentSlug,
      model: opts.model,
      budget: opts.budget,
      renderHost: entry.renderHost,
      systemSpaceDirs,
      preloadSpaceDirs,
      projectSpacesDir,
      projectId,
      projectRoot: join(root, projectId),
      appGlobals,
    });

    // Wire up the tracer to this session's hub + cost tracking.
    this.wireTracer(session, entry);

    // Seed the hub with persisted trace events so the WS trace_snapshot shows
    // the prior conversation immediately when a client connects.
    const tracePath = join(snapshotDir, 'trace.json');
    try {
      const raw = await readFile(tracePath, 'utf8');
      const events = JSON.parse(raw) as Array<{ seq: number; event: import('@lmthing/core').TraceEvent }>;
      for (const ev of events) {
        entry.hub.push(ev.event);
      }
    } catch {
      // No persisted trace — that's fine.
    }

    // Fill in the placeholder.
    entry.session = session;
    entry.spaceDir = spaceDir;
    entry.needsResume = true;
    entry.snapshotDir = snapshotDir;

    void sessionId; // used in parent scope for routing
  }

  /** Persist a session's snapshot, meta, and trace to disk. Best-effort. */
  private async persistSession(entry: SessionEntry): Promise<void> {
    if (!this.lmthingRoot || !entry.projectId || !entry.session || !entry.snapshotDir) return;
    const snapshotDir = entry.snapshotDir;
    try {
      await saveSnapshot(snapshotDir, {
        sessionId: entry.sessionId,
        agentSlug: entry.agentSlug,
        spaceDir: entry.spaceDir,
        history: entry.session.getHistory(),
        scope: {},
        createdAt: entry.createdAt,
      });

      const meta: PersistedSessionMeta = {
        sessionId: entry.sessionId,
        projectId: entry.projectId,
        agentSlug: entry.agentSlug,
        spaceDir: entry.spaceDir,
        title: entry.title ?? '',
        slug: entry.slug,
        createdAt: entry.createdAt,
        lastActivity: entry.lastActivity,
        messageCount: entry.messageCount,
        status: entry.status,
        totalCostUsd: entry.totalCostUsd > 0 ? entry.totalCostUsd : undefined,
      };
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(join(snapshotDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

      const snap = entry.hub.snapshot();
      await writeFile(join(snapshotDir, 'trace.json'), JSON.stringify(snap.events), 'utf8');
    } catch (err) {
      console.warn(`[session-manager] persistSession ${entry.sessionId} failed:`, err instanceof Error ? err.message : err);
    }
  }

  getSession(id: string): SessionEntry | undefined {
    return this.sessions.get(id);
  }

  listSessions(): SessionMeta[] {
    return [...this.sessions.values()].map((e) => ({
      sessionId: e.sessionId,
      spaceDir: e.spaceDir,
      agentSlug: e.agentSlug,
      lastActivity: e.lastActivity,
      started: e.started,
      status: e.status,
    }));
  }

  /** Send a user message: start() on first message, continue() after. Surfaces
   *  errors via the entry's renderHost like serve.ts does. */
  sendMessage(id: string, content: string): void {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`unknown session "${id}"`);
    if (!entry.session) throw new Error(`session "${id}" is still initializing — retry in a moment`);

    // Set title from first message.
    if (!entry.title) entry.title = content.trim().slice(0, 80);
    entry.messageCount++;

    // Write user message as a trace event so it appears in the conversation.
    // Attribute it to the session root node so the reducer never falls back to a
    // phantom/legacy node (which would hijack rootId and hide the real tree).
    if (typeof entry.session.getTracer === 'function') {
      const nodeId = typeof entry.session.getRootNodeId === 'function' ? entry.session.getRootNodeId() : undefined;
      entry.session.getTracer().write({ ts: Date.now(), type: 'user_message', nodeId, content });
    }

    let run: Promise<void>;
    if (entry.needsResume && entry.snapshotDir) {
      // Resume from saved snapshot.
      const snapshotDir = entry.snapshotDir;
      run = entry.session.resume(snapshotDir, content);
      entry.needsResume = false;
      entry.started = true;
    } else {
      run = entry.started
        ? entry.session.continue(content)
        : entry.session.start(content);
      entry.started = true;
    }

    entry.status = 'running';
    entry.lastActivity = Date.now();
    run
      .then(() => {
        entry.status = 'idle';
        entry.lastActivity = Date.now();
        entry.renderHost.emit({ type: 'done' });
        void this.persistSession(entry);
      })
      .catch((err: unknown) => {
        entry.status = 'error';
        entry.lastActivity = Date.now();
        entry.renderHost.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        void this.persistSession(entry);
      });
  }

  /** Snapshot best-effort, dispose the VM, then drop from the map. */
  async disposeSession(id: string): Promise<boolean> {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    await this.persistSession(entry);
    try {
      entry.session?.dispose();
    } catch {
      /* best-effort */
    }
    this.sessions.delete(id);
    return true;
  }

  // ─── Project lifecycle (only meaningful when lmthingRoot is set) ──────────

  private requireRoot(): string {
    if (!this.lmthingRoot) throw new Error('lmthingRoot not configured');
    return this.lmthingRoot;
  }

  /** Ensure `<root>/user/` exists (creates project.json if absent). */
  async ensureDefaultProject(): Promise<void> {
    await ensureDefaultProject(this.requireRoot());
  }

  /** List all projects under `lmthingRoot`. */
  async listProjects(): Promise<ProjectMeta[]> {
    return listProjects(this.requireRoot());
  }

  /**
   * Create a new project. `name` is a human-readable display name; the id is
   * derived by slugifying it (with a numeric suffix if needed for uniqueness).
   * Returns the project metadata (including the generated id).
   */
  async createProject(name: string): Promise<ProjectMeta> {
    const root = this.requireRoot();
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('project name must be a non-empty string');
    }
    let id = slugify(name.trim());
    // Ensure uniqueness: append a counter if the slug already exists.
    let suffix = 1;
    let candidate = id;
    while (true) {
      // 'system' is reserved for the synthetic system project — never clobber it.
      if (candidate === SYSTEM_PROJECT_ID) {
        candidate = `${id}-${suffix++}`;
        continue;
      }
      try {
        await readProjectMeta(root, candidate);
        // Exists — try a numbered variant.
        candidate = `${id}-${suffix++}`;
      } catch {
        // Doesn't exist — safe to use.
        id = candidate;
        break;
      }
    }
    return scaffoldProject(root, id, name.trim());
  }

  /**
   * Delete a project by id. The default 'user' project can be deleted (the
   * caller layer in serve.ts may choose to guard against it).
   */
  async deleteProject(id: string): Promise<void> {
    const root = this.requireRoot();
    const safe = safeProjectId(id);
    if (!safe) throw new Error(`invalid project id: ${id}`);
    await deleteProject(root, safe);
  }

  /** Read the instructions.md for a project. Returns '' if not found. */
  async getInstructions(id: string): Promise<string> {
    const root = this.requireRoot();
    const safe = safeProjectId(id);
    if (!safe) throw new Error(`invalid project id: ${id}`);
    return getInstructions(root, safe);
  }

  /** Write the instructions.md for a project. */
  async setInstructions(id: string, content: string): Promise<void> {
    const root = this.requireRoot();
    const safe = safeProjectId(id);
    if (!safe) throw new Error(`invalid project id: ${id}`);
    await setInstructions(root, safe, content);
  }

  /** List document names in `<root>/<id>/documents/`. */
  async listDocuments(id: string): Promise<string[]> {
    const root = this.requireRoot();
    const safe = safeProjectId(id);
    if (!safe) throw new Error(`invalid project id: ${id}`);
    return listDocuments(root, safe);
  }

  /**
   * Write a document to `<root>/<id>/documents/<name>`. Validates that the
   * document name is a single safe path segment.
   */
  async addDocument(id: string, name: string, content: string): Promise<void> {
    const root = this.requireRoot();
    const safeId = safeProjectId(id);
    if (!safeId) throw new Error(`invalid project id: ${id}`);
    const safeName = safeDocumentName(name);
    if (!safeName) throw new Error(`invalid document name: ${name}`);
    await addDocument(root, safeId, safeName, content);
  }

  /**
   * List persisted sessions for a project (from disk), overlaid with live
   * session status where applicable. Returns newest-first.
   */
  async listProjectSessions(projectId: string): Promise<PersistedSessionMeta[]> {
    const root = this.requireRoot();
    const safe = safeProjectId(projectId);
    if (!safe) throw new Error(`invalid project id: ${projectId}`);
    const persisted = await listProjectSessions(root, safe);

    // Overlay live status for any session currently in memory.
    const result = persisted.map((meta) => {
      const live = this.sessions.get(meta.sessionId);
      if (!live) return meta;
      return {
        ...meta,
        status: live.status,
        lastActivity: live.lastActivity,
        title: live.title ?? meta.title,
        slug: live.slug ?? meta.slug,
        messageCount: live.messageCount,
        totalCostUsd: live.totalCostUsd > 0 ? live.totalCostUsd : meta.totalCostUsd,
      };
    });

    // Add live sessions that aren't persisted yet (new sessions not yet sent a message).
    for (const [, entry] of this.sessions) {
      if (entry.projectId !== safe) continue;
      if (result.some((m) => m.sessionId === entry.sessionId)) continue;
      result.unshift({
        sessionId: entry.sessionId,
        projectId: safe,
        agentSlug: entry.agentSlug,
        spaceDir: entry.spaceDir,
        title: entry.title ?? '',
        slug: entry.slug,
        createdAt: entry.createdAt,
        lastActivity: entry.lastActivity,
        messageCount: entry.messageCount,
        status: entry.status,
        totalCostUsd: entry.totalCostUsd > 0 ? entry.totalCostUsd : undefined,
      });
    }

    // Sort newest-first.
    return result.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /**
   * List the spaces created under a project (`<root>/<projectId>/spaces/*`),
   * each summarized into a SpaceMeta. Spaces that fail to load are skipped
   * rather than aborting the whole listing. Returns id-sorted.
   */
  async listProjectSpaces(projectId: string): Promise<SpaceMeta[]> {
    const root = this.requireRoot();
    const safe = safeProjectId(projectId);
    if (!safe) throw new Error(`invalid project id: ${projectId}`);
    const dirs = await listProjectSpaceDirs(root, safe);
    const results: SpaceMeta[] = [];
    for (const dir of dirs) {
      try {
        const space = await loadSpace(dir, { requireAgents: false });
        const agents = Object.values(space.agents);
        const lead = agents[0];
        const name = lead?.title || space.packageName || basename(dir);
        const description = describeSpace(lead?.instructBody);
        results.push({
          id: basename(dir),
          name,
          description,
          agents: agents.map((a) => ({
            slug: a.slug,
            title: a.title,
            actions: a.actions.map((act) => ({ id: act.id, label: act.label })),
          })),
          functionCount: Object.keys(space.functions).length,
          componentCount: Object.keys(space.components.view).length + Object.keys(space.components.form).length,
          hasKnowledge: Object.keys(space.knowledge.domains).length > 0,
        });
      } catch {
        // Unreadable / invalid space dir — skip it.
      }
    }
    return results.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getAutocompleteWords(projectId: string): Promise<string[]> {
    const root = this.requireRoot();
    const safe = safeProjectId(projectId);
    if (!safe) throw new Error(`invalid project id: ${projectId}`);
    
    const words = new Set<string>();
    
    const addSpace = (spaceId: string, agents: any) => {
      words.add(`@${spaceId}`);
      for (const [slug, agent] of Object.entries(agents || {})) {
        words.add(`@${spaceId}.${slug}`);
        for (const action of (agent as any).actions ?? []) {
          words.add(`@${spaceId}.${slug}.${action.id}`);
        }
      }
    };

    try {
      const projectSpaces = await this.listProjectSpaces(safe);
      for (const s of projectSpaces) {
        const agentsMap: Record<string, any> = {};
        for (const a of s.agents) agentsMap[a.slug] = a;
        addSpace(s.id, agentsMap);
      }
    } catch {}

    try {
      const sysDirs = await listSystemSpaceDirs(root);
      for (const dir of sysDirs) {
        try {
          const space = await loadSpace(dir, { requireAgents: false });
          addSpace(basename(dir), space.agents);
        } catch {}
      }
    } catch {}

    try {
      const rootSpace = await loadSpace(join(root, safe), { requireAgents: false });
      addSpace(safe, rootSpace.agents);
    } catch {}

    return Array.from(words);
  }

  /**
   * Read all files of a project's space (`<root>/<projectId>/spaces/<spaceId>`)
   * into a flat `{ relPath: content }` map, excluding runtime junk (sessions/,
   * **\/conversations/, .env).
   */
  async readProjectSpaceFiles(projectId: string, spaceId: string): Promise<Record<string, string>> {
    const root = this.requireRoot();
    const safeProj = safeProjectId(projectId);
    if (!safeProj) throw new Error(`invalid project id: ${projectId}`);
    const safeSpace = safeProjectId(spaceId);
    if (!safeSpace) throw new Error(`invalid space id: ${spaceId}`);
    return readSpaceFiles(projectSpaceDir(root, safeProj, safeSpace));
  }

  /**
   * Wipe-and-rewrite a project's space dir with the supplied file map. Each
   * relative path is validated; the dir is removed first so deletions in the
   * editor are reflected on disk.
   */
  async writeProjectSpaceFiles(
    projectId: string,
    spaceId: string,
    files: Record<string, string>,
  ): Promise<void> {
    const root = this.requireRoot();
    const safeProj = safeProjectId(projectId);
    if (!safeProj) throw new Error(`invalid project id: ${projectId}`);
    const safeSpace = safeProjectId(spaceId);
    if (!safeSpace) throw new Error(`invalid space id: ${spaceId}`);
    await writeSpaceFiles(projectSpaceDir(root, safeProj, safeSpace), files);
  }

  /**
   * Create or overwrite a single file within a project's space dir
   * (`<root>/<projectId>/spaces/<spaceId>/<relPath>`), creating parent dirs as
   * needed. Throws on an invalid project/space id, an unsafe `relPath`, or a
   * path targeting excluded runtime junk (`sessions/`, `conversations/`, `.env*`).
   */
  async writeProjectSpaceFile(
    projectId: string,
    spaceId: string,
    relPath: string,
    content: string,
  ): Promise<void> {
    const root = this.requireRoot();
    const safeProj = safeProjectId(projectId);
    if (!safeProj) throw new Error(`invalid project id: ${projectId}`);
    const safeSpace = safeProjectId(spaceId);
    if (!safeSpace) throw new Error(`invalid space id: ${spaceId}`);
    await writeSpaceFile(projectSpaceDir(root, safeProj, safeSpace), relPath, content);
  }

  /**
   * Delete a single file within a project's space dir. Throws on an invalid
   * project/space id, an unsafe/excluded `relPath`, or if the file does not
   * exist (callers map that to a 404).
   */
  async deleteProjectSpaceFile(projectId: string, spaceId: string, relPath: string): Promise<void> {
    const root = this.requireRoot();
    const safeProj = safeProjectId(projectId);
    if (!safeProj) throw new Error(`invalid project id: ${projectId}`);
    const safeSpace = safeProjectId(spaceId);
    if (!safeSpace) throw new Error(`invalid space id: ${spaceId}`);
    await deleteSpaceFile(projectSpaceDir(root, safeProj, safeSpace), relPath);
  }

  startReaper(intervalMs = 60000): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.sessions) {
        if (now - entry.lastActivity > this.idleTtlMs) {
          console.warn(`[session-manager] reaping idle session ${id}`);
          void this.disposeSession(id);
        }
      }
    }, intervalMs);
    // Don't keep the process alive solely for the reaper.
    this.reaper.unref?.();
  }

  stopReaper(): void {
    if (this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
  }
}

/**
 * Extract a one-line description from an agent's instruct body: the first
 * non-empty line that isn't a markdown heading. Truncated to ~140 chars.
 */
function describeSpace(instructBody: string | undefined): string {
  if (!instructBody) return '';
  for (const raw of instructBody.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    return line.length > 140 ? `${line.slice(0, 137)}...` : line;
  }
  return '';
}

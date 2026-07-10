import { randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Session, saveSnapshot, loadSpace } from '@lmthing/core';
import type { StreamOpts, StreamSession, AppGlobalImpls, ConnectionResolver, ReadDocumentResult, TraceAttachment, UserInput } from '@lmthing/core';
import { createConnectionResolver } from './connections.js';
import type { PluginRegistry } from '@lmthing/openclaw-compat';
import { transcribeAudio } from '../providers/transcribe.js';
import {
  resolveUploadsDir,
  saveUpload as saveUploadToDisk,
  readUploadMeta,
  readUploadBytes,
  uploadUrl,
  classifyKind,
  assembleParts,
  extractDocumentText,
  resolveUploadDocument,
  type AttachmentRef,
} from './uploads.js';
import { bootProjectApp } from '../app/boot.js';
import { createApiRuntime, type ApiRuntime } from '../app/api/runtime.js';
import type { ProjectDb } from '../app/store.js';
import { createAppAuthoringGlobals, resolveCatalogRoot, type AppAuthoringGlobals } from '../app/authoring/index.js';
import { generateProjectContracts, type ProjectContracts } from '../app/build/contracts.js';
import { loadHooks } from '../app/hooks/index.js';
import { ProjectHookRuntime } from '../app/hooks/runtime.js';
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
  spaceSessionsDir,
  listSpaceSessions,
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
  /** When set (spaceRef-created session), the project-relative space basename this
   *  session is bound to. Selects the per-space snapshot dir
   *  (`<project>/spaces/<spaceId>/sessions/<id>`) for persist + resume. */
  spaceId?: string;
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
  /** Project-generated typed `apiCall` overloads (Phase 4) for the agent's DTS. */
  appDts?: string;
  model?: string;
  budget?: {
    maxEpisodes?: number;
    maxToolCalls?: number;
    maxForkDepth?: number;
    maxWallClockMs?: number;
  };
  renderHost: WebRenderHost;
  /** Optional NDJSON trace file (headless runs may want a trace on disk). */
  traceFile?: string;
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

/** Parse a `space/agent#action` spawn ref → the pieces `runHeadless` wants
 *  (mirrors the hook `parseTrigger`). No `#` ⇒ the whole ref is the space, no action. */
function parseAgentRef(ref: string): { spaceRef: string; agentSlug: string; action: string } {
  const hash = ref.indexOf('#');
  const spaceRef = hash >= 0 ? ref.slice(0, hash) : ref;
  const action = hash >= 0 ? ref.slice(hash + 1) : '';
  const agentSlug = spaceRef.split('/').pop() ?? spaceRef;
  return { spaceRef, agentSlug, action };
}

/** Best-effort JSON for embedding spawn input into the agent's kickoff message. */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Run a project api endpoint by name and unwrap it to a value/throw — the
 *  agent-facing `apiCall` contract (mirrors the runtime's internal resolver): a
 *  ≥400 status becomes a thrown Error carrying `.status`, else the body is returned. */
async function unwrapApiCall(rt: ApiRuntime, name: string, input?: unknown): Promise<unknown> {
  const res = await rt.callByName(name, input);
  if (res.status >= 400) {
    const body = res.body as { error?: { message?: string } } | undefined;
    const err = new Error(body?.error?.message ?? `apiCall("${name}") failed`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.body;
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
  /** Pod-side resolvers for the agent `callConnection` global, cached per project
   *  root. Built-in providers (slack/github/google) work in every project; a
   *  provider contributed by an INSTALLED integration space is discovered by
   *  scanning `<projectRoot>/spaces/` — so the resolver is project-scoped.
   *  Bring-your-own-token: it reads each provider's token from the pod env
   *  (Settings → Integrations) and calls the provider directly; it throws a clear
   *  per-provider "not configured" error when a token env var is unset. */
  private connectionResolvers = new Map<string, ConnectionResolver>();
  /** Pod-side registry of loaded OpenClaw-compat plugin tools (see
   *  `server/openclaw-host.ts` `loadOpenClawPlugins`). Wired once at boot via
   *  {@link setToolRegistry}; `undefined` when no `.openclaw-plugins/` dir was
   *  loaded (or no plugin registered a tool) — the yield router then throws the
   *  clear "no tool registry configured" error. Project-independent (attached
   *  to EVERY session), same as the connection resolver above. */
  private toolRegistry?: PluginRegistry;
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

  /** Lazily build (and cache) the connection resolver for a project root. */
  private getConnectionResolver(projectRoot?: string): ConnectionResolver {
    const key = projectRoot ?? '';
    let resolver = this.connectionResolvers.get(key);
    if (!resolver) {
      resolver = createConnectionResolver(projectRoot);
      this.connectionResolvers.set(key, resolver);
    }
    return resolver;
  }

  /** Fold the project-independent `callConnection` resolver into a session's app
   *  globals so EVERY session (project, legacy, headless) can use connections
   *  (bring-your-own-token — the resolver reads each provider's token from the
   *  pod env). When no resolver is configured, the field is left absent so the
   *  router emits the clear "no connection resolver configured" error. */
  private withConnections(appGlobals?: AppGlobalImpls, projectRoot?: string): AppGlobalImpls | undefined {
    const resolver = this.getConnectionResolver(projectRoot);
    return { ...appGlobals, callConnection: appGlobals?.callConnection ?? resolver };
  }

  /** Wire a loaded OpenClaw `PluginRegistry` so agent `tool()` calls can dispatch
   *  to its registered tools. Called once from `serve.ts` after
   *  `loadOpenClawPlugins` resolves (best-effort — a pod with no
   *  `.openclaw-plugins/` dir never calls this, so `tool()` stays unavailable). */
  setToolRegistry(registry: PluginRegistry): void {
    this.toolRegistry = registry;
  }

  /** Resolve a `tool()` yield by dispatching to the loaded `PluginRegistry` —
   *  mirrors the agent-facing `apiCall` contract: an unknown tool name throws
   *  (fail loud), a registered tool's `execute(callId, params)` result is
   *  returned verbatim (the `{ content: [...] }` shape). */
  private async resolveTool(name: string, input?: unknown): Promise<unknown> {
    const tool = this.toolRegistry?.getTool(name);
    if (!tool) {
      throw new Error(`tool("${name}") not found: no OpenClaw plugin registered a tool with that name`);
    }
    return tool.execute(randomUUID(), (input as Record<string, unknown>) ?? {});
  }

  /** Fold the project-independent `tool` resolver into a session's app globals so
   *  EVERY session (when granted `tools:use`) can dispatch to a loaded OpenClaw
   *  plugin tool. When no registry is set, the field is left absent so the router
   *  emits the clear "no tool registry configured" error. */
  private withTools(appGlobals?: AppGlobalImpls): AppGlobalImpls | undefined {
    if (!this.toolRegistry) return appGlobals;
    return { ...appGlobals, tool: appGlobals?.tool ?? ((name: string, input?: unknown) => this.resolveTool(name, input)) };
  }

  /** Pod-side resolver for the universal `readDocument` global — extract a stored
   *  upload's content Node-side (see {@link resolveUploadDocument}). Attached to
   *  EVERY session (project-independent). */
  private resolveDocument(attachmentId: string, opts?: { maxChars?: number }): Promise<ReadDocumentResult> {
    return resolveUploadDocument(this.uploadsDir, attachmentId, opts);
  }

  /** Default session builder — constructs a Session bound to `streamFn`. */
  private defaultBuildSession(args: BuildSessionArgs): Session {
    return new Session(
      {
        spaceDir: args.spaceDir,
        agentSlug: args.agentSlug,
        modelAlias: args.model ?? this.defaultModelAlias ?? 'default',
        renderHost: args.renderHost,
        traceFile: args.traceFile,
        budget: args.budget,
        maxHistoryTurns: 20,
        systemSpaceDirs: args.systemSpaceDirs,
        preloadSpaceDirs: args.preloadSpaceDirs,
        projectSpacesDir: args.projectSpacesDir,
        projectId: args.projectId,
        projectRoot: args.projectRoot,
        appGlobals: this.withTools(this.withConnections(args.appGlobals, args.projectRoot)),
        appDts: args.appDts,
        documentResolver: (id, opts) => this.resolveDocument(id, opts),
      },
      { streamFn: this.streamFn },
    );
  }

  /** Per-project app-db cache. Lazily boots (restore→open→reconcile, fail-loud on
   *  non-additive schema drift) on first use and reuses the handle across sessions in
   *  that project; `null` is cached for spaces-only projects (e.g. `system`) so we don't
   *  re-probe every session. Closed in {@link closeProjectDbs} on shutdown. */
  private projectDbs = new Map<string, ProjectDb | null>();

  /** Boot (once) and return the project's app db, or `null` for a spaces-only project.
   *  Cached across sessions in that project; the same handle backs the agent's sync `db`
   *  global (via {@link getProjectAppGlobals}) AND the Node api runtime (`.async`). */
  /** Per-project database-hook dispatch runtimes (wired to the db's onWrite seam). */
  private projectHookRuntimes = new Map<string, ProjectHookRuntime>();

  async getProjectDb(root: string, projectId: string): Promise<ProjectDb | null> {
    let db = this.projectDbs.get(projectId);
    if (db === undefined) {
      db = await bootProjectApp(join(root, projectId));
      this.projectDbs.set(projectId, db);
      // Wire the project's `database` hooks to the db's onWrite seam (Phase 6). Once per
      // project, when the db first boots. A project with no db/hooks gets nothing.
      if (db && !this.projectHookRuntimes.has(projectId)) {
        try {
          const hooks = await loadHooks(join(root, projectId));
          if (hooks.some((h) => (h.def as { type?: string }).type === 'database')) {
            this.projectHookRuntimes.set(projectId, new ProjectHookRuntime(projectId, root, this, db, hooks));
          }
        } catch (err) {
          console.warn(`[hooks] failed to wire database hooks for "${projectId}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    return db;
  }

  /** One authoring-globals instance per SessionManager (lazy singleton), so
   *  `currentApp` state (createProject/selectProject) is shared across a
   *  delegation tree within this manager rather than reset per session. */
  private authoringGlobals: AppAuthoringGlobals | undefined;

  private getAuthoringGlobals(): AppAuthoringGlobals {
    if (!this.authoringGlobals) {
      this.authoringGlobals = createAppAuthoringGlobals({ catalogRoot: resolveCatalogRoot() });
    }
    return this.authoringGlobals;
  }

  private async getProjectAppGlobals(root: string, projectId: string): Promise<AppGlobalImpls | undefined> {
    const db = await this.getProjectDb(root, projectId);
    const authoring = this.getAuthoringGlobals();
    const apiRt = await this.getApiRuntime(root, projectId);
    return {
      ...(db ? { db: db.db } : undefined),
      // Agent-facing apiCall — re-enter the project's OWN api endpoints by name
      // (same runtime the browser + hooks use). Only present when the project has
      // an `api/` dir; the yield router rejects apiCall() otherwise.
      ...(apiRt ? { apiCall: (name: string, input?: unknown) => unwrapApiCall(apiRt, name, input) } : undefined),
      writePage: authoring.writePage,
      writeApi: authoring.writeApi,
      writeHook: authoring.writeHook,
      writeTableSchema: authoring.writeTableSchema,
      createProject: authoring.createProject,
      selectProject: authoring.selectProject,
    };
  }

  /** Per-project api runtime (main-process), cached. Backs BOTH the browser-facing
   *  `/app/<project>/api/*` handler AND the agent-facing `apiCall` global, and its
   *  `spawn` seam runs a REAL fire-and-forget headless agent via {@link runHeadless}
   *  (this replaces the old Phase-3 no-op stub). `null` is cached for a project with
   *  no `api/` dir. Closed in {@link closeProjectDbs} on shutdown. */
  private apiRuntimes = new Map<string, ApiRuntime | null>();

  async getApiRuntime(root: string, projectId: string): Promise<ApiRuntime | null> {
    let rt = this.apiRuntimes.get(projectId);
    if (rt !== undefined) return rt;
    rt = null;
    const projectDb = await this.getProjectDb(root, projectId);
    if (projectDb) {
      const contracts = await this.getProjectContracts(root, projectId);
      rt = createApiRuntime({
        projectRoot: join(root, projectId),
        db: projectDb.async,
        validators: contracts?.validators,
        // Real fire-and-forget agent runner (was a stub returning a bare runId). A
        // `spawn(ref, input)` from an api handler starts an ISOLATED headless session
        // — exactly like a declarative hook `trigger` — so the agent actually runs.
        // Errors surface async (logged); the synchronous-onError seam is unused here.
        spawnRunner: (ref, input) => {
          const runId = randomUUID();
          const { spaceRef, agentSlug, action } = parseAgentRef(ref);
          const message =
            `Spawned run "${ref}"` +
            (action ? ` — perform the "${action}" action.` : '.') +
            (input != null ? `\nInput: ${safeStringify(input)}` : '');
          void this.runHeadless({ projectId, spaceRef, agentSlug, message }).catch((err) => {
            console.warn(
              `[app-api] spawn("${ref}") failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
          return { runId };
        },
      });
    }
    this.apiRuntimes.set(projectId, rt);
    return rt;
  }

  /** Close all cached project db handles (call on server shutdown). */
  closeProjectDbs(): void {
    for (const rt of this.apiRuntimes.values()) {
      try { rt?.dispose(); } catch { /* best-effort */ }
    }
    this.apiRuntimes.clear();
    for (const rt of this.projectHookRuntimes.values()) {
      try { rt.dispose(); } catch { /* best-effort */ }
    }
    this.projectHookRuntimes.clear();
    for (const db of this.projectDbs.values()) {
      try { db?.close(); } catch { /* best-effort */ }
    }
    this.projectDbs.clear();
  }

  /** Per-project Phase-4 typed-contract bundle (validators + apiCall DTS + generated types).
   *  Generated once (heavy: ts-json-schema-generator) and cached; `null` when the project has
   *  no `api/` dir. Feeds both the api runtime (validators) and the session (apiCall DTS). */
  private projectContracts = new Map<string, ProjectContracts | null>();

  async getProjectContracts(root: string, projectId: string): Promise<ProjectContracts | null> {
    let c = this.projectContracts.get(projectId);
    if (c === undefined) {
      const projectRoot = join(root, projectId);
      c = null;
      if (existsSync(join(projectRoot, 'api'))) {
        try {
          c = await generateProjectContracts(projectRoot);
        } catch (err) {
          console.warn(`[app] failed to generate contracts for "${projectId}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.projectContracts.set(projectId, c);
    }
    return c;
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
    return this.evictOneIdle();
  }

  /**
   * Evict the least-recently-active NON-running session, persisting it first so it
   * resumes transparently when reopened. Frees exactly one slot. Returns false
   * only when every resident session is actively running (nothing safe to evict).
   *
   * Reused by both the capacity gate ({@link ensureCapacity}) and the in-pod memory
   * watchdog (P3): under memory pressure the watchdog sheds idle sessions this way
   * — a graceful, recoverable shrink instead of a data-losing cgroup OOMKill.
   */
  evictOneIdle(): boolean {
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
    console.warn(`[session-manager] evicted idle session ${evicted.sessionId} (persist-first)`);
    void (async () => {
      try { await this.persistSession(evicted); } catch { /* best-effort */ }
      try { evicted.session?.dispose(); } catch { /* best-effort */ }
    })();
    return true;
  }

  /** Number of resident sessions (each is a live QuickJS VM). */
  residentCount(): number {
    return this.sessions.size;
  }

  /** Number of sessions currently running a turn (never evicted / scaled-down under). */
  runningCount(): number {
    let n = 0;
    for (const e of this.sessions.values()) if (e.status === 'running') n++;
    return n;
  }

  /** Epoch-ms of the most recent activity across resident sessions (0 if none). */
  lastActivityAt(): number {
    let max = 0;
    for (const e of this.sessions.values()) {
      if (e.lastActivity > max) max = e.lastActivity;
    }
    return max;
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
    /** Project-relative `space/agent` (e.g. `curation/curator`). In project mode
     *  this loads that specific space's agent with full project capability
     *  inheritance and persists the session under
     *  `<project>/spaces/<space>/sessions/<id>`. On resume, pass the same ref so
     *  the per-space snapshot dir is located. */
    spaceRef?: string;
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

      // A spaceRef-bound session persists under the per-space dir; a plain
      // project session under `<project>/sessions/`.
      let spaceId: string | undefined;
      let snapshotDir: string;
      if (opts.spaceRef) {
        spaceId = parseSpaceRef(opts.spaceRef).space;
        snapshotDir = join(spaceSessionsDir(root, projectId, spaceId), resumeId);
      } else {
        snapshotDir = join(sessionsDir(root, projectId), resumeId);
      }
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
        spaceId,
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
      // A spaceRef-created session (chat bound to `space/agent`) persists under
      // the per-space sessions dir; a plain project session under
      // `<project>/sessions/`. `spaceId` is recorded so persist/list resolve the
      // same dir later. The agent segment (if any) is resolved async.
      let spaceId: string | undefined;
      let snapshotDir: string;
      let placeholderAgentSlug = opts.agentSlug ?? 'thing';
      if (opts.spaceRef) {
        const ref = parseSpaceRef(opts.spaceRef);
        spaceId = ref.space;
        if (ref.agent) placeholderAgentSlug = ref.agent;
        snapshotDir = join(spaceSessionsDir(root, projectId, spaceId), sessionId);
      } else {
        snapshotDir = join(sessionsDir(root, projectId), sessionId);
      }

      // Placeholder entry so callers can look up the session immediately.
      const placeholderEntry: SessionEntry = {
        sessionId,
        session: null as unknown as Session, // filled in by async init
        renderHost,
        hub,
        spaceDir: join(root, projectId),
        agentSlug: placeholderAgentSlug,
        lastActivity: Date.now(),
        started: false,
        status: 'idle',
        projectId,
        spaceId,
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
      spaceRef?: string;
      model?: string;
      budget?: BuildSessionArgs['budget'];
    },
  ): Promise<void> {
    // A spaceRef binds the session to a specific project space + agent; else the
    // agent runs at the project root. Either way it keeps full project context
    // (appGlobals, contracts, preloaded spaces) so its `db` writes fire hooks.
    let spaceDir = join(root, projectId);
    let agentSlug = opts.agentSlug ?? 'thing';
    if (opts.spaceRef) {
      const { space, agent } = parseSpaceRef(opts.spaceRef);
      spaceDir = projectSpaceDir(root, projectId, space);
      agentSlug = agent ?? (await resolveDefaultAgent(spaceDir)) ?? agentSlug;
    }
    const projectSpacesDir = join(root, projectId, 'spaces');

    const [systemSpaceDirs, preloadSpaceDirs] = await Promise.all([
      listSystemSpaceDirs(root),
      listProjectSpaceDirs(root, projectId),
    ]);

    const appGlobals = await this.getProjectAppGlobals(root, projectId);
    const contracts = await this.getProjectContracts(root, projectId);
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
      appDts: contracts?.apiCallDts,
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
      spaceRef?: string;
      model?: string;
      budget?: BuildSessionArgs['budget'];
    },
    sessionId: string,
    snapshotDir: string,
  ): Promise<void> {
    // Resume a spaceRef-bound session against its own space dir; else the
    // project root. agentSlug is restored from persisted meta below.
    const spaceDir = opts.spaceRef
      ? projectSpaceDir(root, projectId, parseSpaceRef(opts.spaceRef).space)
      : join(root, projectId);
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
    const contracts = await this.getProjectContracts(root, projectId);
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
      appDts: contracts?.apiCallDts,
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
        spaceId: entry.spaceId,
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

  /** Absolute path to the shared uploads directory (under the runtime root). */
  private get uploadsDir(): string {
    return resolveUploadsDir(this.lmthingRoot);
  }

  /** Store an uploaded file. Audio is transcribed on the way in (best-effort —
   *  a transcription failure still stores the file, just without a transcript).
   *  Returns a reference the chat client sends back with `sendMessage`. */
  async saveUpload(input: { bytes: Uint8Array; mediaType: string; filename?: string }): Promise<AttachmentRef> {
    let transcript: string | undefined;
    let text: string | undefined;
    const kind = classifyKind(input.mediaType);
    if (kind === 'audio') {
      try {
        transcript = (await transcribeAudio(input.bytes)).text;
      } catch (err) {
        // Non-fatal: the audio is still stored/playable; the model just won't
        // receive a transcript for it.
        // eslint-disable-next-line no-console
        console.warn(`[uploads] transcription failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (kind === 'file') {
      // Binary documents (PDF, …): extract text now so the files agent — which
      // runs a text model that can't ingest a raw file part — reads real text.
      try {
        text = await extractDocumentText(input.mediaType, input.bytes);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[uploads] text extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const meta = await saveUploadToDisk(this.uploadsDir, { ...input, ...(transcript ? { transcript } : {}), ...(text ? { text } : {}) });
    return { ...meta, url: uploadUrl(meta.id) };
  }

  /** Read a stored upload's bytes + metadata for the serving route. */
  async readUpload(id: string): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
    const meta = await readUploadMeta(this.uploadsDir, id);
    if (!meta) return null;
    const bytes = await readUploadBytes(this.uploadsDir, id);
    if (!bytes) return null;
    return { bytes, mediaType: meta.mediaType };
  }

  /** Assemble the model input (text + image/file parts) and the trace-facing
   *  attachment list from stored uploads. Server-authoritative: only the id is
   *  trusted; bytes/metadata are re-read from disk. Audio contributes its
   *  transcript to the text (the model gets text, not the raw audio). */
  private async assembleAttachments(
    content: string,
    attachmentIds: string[],
  ): Promise<{ input: UserInput; traceAttachments?: TraceAttachment[] }> {
    const items = await Promise.all(
      attachmentIds.map(async (aid) => {
        const meta = await readUploadMeta(this.uploadsDir, aid);
        // Audio needs no bytes (it rides as a transcript); skip the read for it.
        const bytes = meta && meta.kind !== 'audio' ? await readUploadBytes(this.uploadsDir, aid) : null;
        return { meta, bytes };
      }),
    );
    const { attachments, traceAttachments, transcripts } = assembleParts(items);
    // Audio transcripts fold into the text (handled by the text model directly);
    // image/file attachments ride as delegatable attachments (THING routes each
    // to a vision/file agent by id).
    const text = transcripts.length ? [content, ...transcripts].filter(Boolean).join('\n\n') : content;
    const input: UserInput = attachments.length ? { text, attachments } : text;
    return { input, ...(traceAttachments.length ? { traceAttachments } : {}) };
  }

  /** Send a user message: start() on first message, continue() after. Surfaces
   *  errors via the entry's renderHost like serve.ts does. `attachmentIds` name
   *  previously-uploaded files (see saveUpload) to attach to this turn. */
  async sendMessage(id: string, content: string, attachmentIds?: string[]): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`unknown session "${id}"`);
    if (!entry.session) throw new Error(`session "${id}" is still initializing — retry in a moment`);

    // Set title from first message.
    if (!entry.title) entry.title = content.trim().slice(0, 80);
    entry.messageCount++;

    const { input, traceAttachments } =
      attachmentIds && attachmentIds.length
        ? await this.assembleAttachments(content, attachmentIds)
        : { input: content as UserInput, traceAttachments: undefined };

    // Write user message as a trace event so it appears in the conversation.
    // Attribute it to the session root node so the reducer never falls back to a
    // phantom/legacy node (which would hijack rootId and hide the real tree).
    if (typeof entry.session.getTracer === 'function') {
      const nodeId = typeof entry.session.getRootNodeId === 'function' ? entry.session.getRootNodeId() : undefined;
      entry.session.getTracer().write({ ts: Date.now(), type: 'user_message', nodeId, content, ...(traceAttachments ? { attachments: traceAttachments } : {}) });
    }

    let run: Promise<void>;
    if (entry.needsResume && entry.snapshotDir) {
      // Resume from saved snapshot.
      const snapshotDir = entry.snapshotDir;
      run = entry.session.resume(snapshotDir, input);
      entry.needsResume = false;
      entry.started = true;
    } else {
      run = entry.started
        ? entry.session.continue(input)
        : entry.session.start(input);
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

  /**
   * Run one agent turn **headlessly** and return its result, then tear the VM
   * down. Consolidates the `bin.ts --request` single-shot pattern (build a
   * Session with the SAME project wiring the interactive path uses → app db +
   * typed apiCall + system/preload spaces → `start(message)` → dispose) INTO the
   * manager so a hook (Phase 6) can run an agent and capture its output.
   *
   * The session is **ephemeral**: it is NEVER registered in `this.sessions`, so
   * it does not count against `maxSessions`, is never persisted, and is fully
   * isolated from the interactive session lifecycle. Its own throwaway
   * {@link WebRenderHost} swallows display/ask/log (no hub is wired). `budget`
   * (if given) applies host-enforced caps so a hook runs bounded.
   *
   * Resolution mirrors the interactive project path:
   *   - `root = this.lmthingRoot`, `projectId = opts.projectId ?? DEFAULT_PROJECT_ID`,
   *     `projectRoot = <root>/<projectId>`.
   *   - `spaceDir`: `opts.spaceDir` if given; else if `opts.spaceRef` a
   *     project-relative space under `<projectRoot>/spaces/<space>` (Phase 7
   *     formalizes `spaceRef` — `space/agent`/nested paths; here we take the
   *     leading segment as the space dir and ignore any trailing `/agent`); else
   *     the project dir itself.
   *
   * @returns `{ ok:true, result, sessionId }` where `result` is the agent's
   *   final output (last `display(...)` descriptor, else the last history
   *   message content), or `{ ok:false, error, sessionId }` on any throw.
   */
  async runHeadless(opts: {
    projectId?: string;
    spaceRef?: string;
    spaceDir?: string;
    agentSlug: string;
    message: string;
    budget?: BuildSessionArgs['budget'];
    traceFile?: string;
  }): Promise<{ ok: boolean; result?: unknown; error?: string; sessionId: string }> {
    const sessionId = randomUUID();
    let session: Session | undefined;
    const displays: unknown[] = [];
    try {
      const args = await this.buildProjectSessionArgs(opts);
      session = this.buildSessionFn(args);

      // Capture display descriptors so we can return the agent's final output.
      // We subscribe to the session's OWN tracer (not a hub) — this run is
      // isolated from every interactive session.
      if (typeof session.getTracer === 'function') {
        session.getTracer().subscribe((e) => {
          if (e.type === 'display') displays.push(e.descriptor);
        });
      }

      await session.start(opts.message);

      const lastDisplay = displays.length ? displays[displays.length - 1] : undefined;
      let result: unknown = lastDisplay;
      if (result === undefined && typeof session.getHistory === 'function') {
        const history = session.getHistory();
        result = history.length ? history[history.length - 1]?.content : undefined;
      }
      return { ok: true, result, sessionId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), sessionId };
    } finally {
      try {
        session?.dispose();
      } catch {
        /* best-effort */
      }
    }
  }

  /**
   * Build the `BuildSessionArgs` for a one-shot headless run (project-mode
   * resolution mirrored from the interactive path — see {@link runHeadless}'s
   * former inline body). Shared by {@link runHeadless} (fresh, unpersisted VM)
   * and {@link runHeadlessThreaded} (same wiring, but resumed/persisted against
   * a stable snapshot dir).
   *
   * Resolution:
   *   - `root = this.lmthingRoot`, `projectId = opts.projectId ?? DEFAULT_PROJECT_ID`,
   *     `projectRoot = <root>/<projectId>`.
   *   - `spaceDir`: `opts.spaceDir` if given; else if `opts.spaceRef` a
   *     project-relative space under `<projectRoot>/spaces/<space>` (leading
   *     segment only — trailing `/agent` is ignored here); else the project dir
   *     itself.
   *   - No `lmthingRoot`: legacy fallback to a bare `opts.spaceDir ?? this.defaultSpaceDir`
   *     build (no project wiring).
   */
  private async buildProjectSessionArgs(opts: {
    projectId?: string;
    spaceRef?: string;
    spaceDir?: string;
    agentSlug: string;
    budget?: BuildSessionArgs['budget'];
    traceFile?: string;
  }): Promise<BuildSessionArgs> {
    const root = this.lmthingRoot;
    if (!root) {
      // No project root: fall back to a bare space-dir build (legacy mode).
      const spaceDir = opts.spaceDir ?? this.defaultSpaceDir;
      if (!spaceDir) {
        throw new Error('runHeadless: no spaceDir provided and no lmthingRoot/defaultSpaceDir configured');
      }
      return {
        spaceDir,
        agentSlug: opts.agentSlug,
        budget: opts.budget,
        traceFile: opts.traceFile,
        renderHost: new WebRenderHost(),
      };
    }

    const projectId = opts.projectId ?? DEFAULT_PROJECT_ID;
    const projectRoot = join(root, projectId);

    // Resolve the space dir (Phase 7 will extend spaceRef parsing).
    let spaceDir: string;
    if (opts.spaceDir) {
      spaceDir = opts.spaceDir;
    } else if (opts.spaceRef) {
      const spaceName = opts.spaceRef.split('/')[0] ?? opts.spaceRef;
      spaceDir = join(projectRoot, 'spaces', spaceName);
    } else {
      spaceDir = projectRoot;
    }

    const projectSpacesDir = join(projectRoot, 'spaces');
    const [systemSpaceDirs, preloadSpaceDirs] = await Promise.all([
      listSystemSpaceDirs(root),
      listProjectSpaceDirs(root, projectId),
    ]);
    const appGlobals = await this.getProjectAppGlobals(root, projectId);
    const contracts = await this.getProjectContracts(root, projectId);

    return {
      spaceDir,
      agentSlug: opts.agentSlug,
      budget: opts.budget,
      traceFile: opts.traceFile,
      renderHost: new WebRenderHost(),
      systemSpaceDirs,
      preloadSpaceDirs,
      projectSpacesDir,
      projectId,
      projectRoot,
      appGlobals,
      appDts: contracts?.apiCallDts,
    };
  }

  /** Per-sessionId chain of in-flight {@link runHeadlessThreaded} turns, so two
   *  near-simultaneous inbound events on the SAME thread never resume the same
   *  on-disk snapshot concurrently (which would silently lose one update). Each
   *  call is queued behind the previous one for its `sessionId`; unrelated
   *  sessionIds run fully in parallel. Entries are removed once their chain
   *  drains, so this never grows unbounded. */
  private threadLocks = new Map<string, Promise<void>>();

  private runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.threadLocks.get(key) ?? Promise.resolve();
    const result = prior.then(fn, fn);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.threadLocks.set(key, tail);
    void tail.finally(() => {
      if (this.threadLocks.get(key) === tail) this.threadLocks.delete(key);
    });
    return result;
  }

  /**
   * Run one agent turn **threaded**: like {@link runHeadless}, but bound to a
   * caller-provided STABLE `sessionId` (minted by the webhook-thread store) so
   * repeated inbound events on the same external thread continue ONE persisted
   * multi-turn session instead of a fresh one-shot each time.
   *
   * Snapshot dir resolution mirrors {@link createSession}'s resume path:
   * `opts.spaceRef` → `spaceSessionsDir(root, projectId, spaceId)/<sessionId>`,
   * else `sessionsDir(root, projectId)/<sessionId>`. If a snapshot already
   * exists there, `session.resume()` continues it; otherwise `session.start()`
   * begins it. Either way the turn is persisted back to the SAME snapshot dir
   * afterward (`saveSnapshot`, mirroring `persistSession`'s shape), so the next
   * call for this `sessionId` resumes it.
   *
   * Project-mode only (requires `lmthingRoot`) — threading has no meaning for
   * the legacy bare-spaceDir mode. Like `runHeadless`, the session is NEVER
   * registered in `this.sessions`: it doesn't count against `maxSessions` and
   * has its own throwaway `WebRenderHost` (no hub). Concurrent calls for the
   * same `sessionId` are serialized (see {@link runExclusive}) so they can't
   * race on the same snapshot file.
   */
  async runHeadlessThreaded(opts: {
    sessionId: string;
    projectId?: string;
    spaceRef?: string;
    agentSlug: string;
    message: string;
    budget?: BuildSessionArgs['budget'];
  }): Promise<{ ok: boolean; result?: unknown; error?: string; sessionId: string }> {
    return this.runExclusive(opts.sessionId, async () => {
      let session: Session | undefined;
      const displays: unknown[] = [];
      try {
        const root = this.lmthingRoot;
        if (!root) {
          throw new Error('runHeadlessThreaded: no lmthingRoot configured — threading is project-mode only');
        }
        const projectId = opts.projectId ?? DEFAULT_PROJECT_ID;

        // A spaceRef-bound session persists under the per-space dir; a plain
        // project session under `<project>/sessions/` — same rule as
        // createSession's resume path.
        let snapshotDir: string;
        if (opts.spaceRef) {
          const spaceId = parseSpaceRef(opts.spaceRef).space;
          snapshotDir = join(spaceSessionsDir(root, projectId, spaceId), opts.sessionId);
        } else {
          snapshotDir = join(sessionsDir(root, projectId), opts.sessionId);
        }
        const snapshotFile = join(snapshotDir, 'snapshot.json');

        const args = await this.buildProjectSessionArgs({
          projectId,
          spaceRef: opts.spaceRef,
          agentSlug: opts.agentSlug,
          budget: opts.budget,
        });
        session = this.buildSessionFn(args);

        // Capture display descriptors so we can return the agent's final output —
        // same isolated-tracer pattern as runHeadless (no hub is wired).
        if (typeof session.getTracer === 'function') {
          session.getTracer().subscribe((e) => {
            if (e.type === 'display') displays.push(e.descriptor);
          });
        }

        // Preserve the original createdAt across a resume (best-effort — a
        // missing/corrupt existing snapshot just falls back to "now", which is
        // fine since it's cosmetic metadata, not the source of truth for history).
        let createdAt = Date.now();
        const resuming = existsSync(snapshotFile);
        if (resuming) {
          try {
            const raw = await readFile(snapshotFile, 'utf8');
            const existing = JSON.parse(raw) as { createdAt?: number };
            if (typeof existing.createdAt === 'number') createdAt = existing.createdAt;
          } catch {
            // Corrupt/unreadable snapshot meta — createdAt falls back to now.
          }
          await session.resume(snapshotDir, opts.message);
        } else {
          await session.start(opts.message);
        }

        await saveSnapshot(snapshotDir, {
          sessionId: opts.sessionId,
          agentSlug: opts.agentSlug,
          spaceDir: args.spaceDir,
          history: session.getHistory(),
          scope: {},
          createdAt,
        });

        const lastDisplay = displays.length ? displays[displays.length - 1] : undefined;
        let result: unknown = lastDisplay;
        if (result === undefined && typeof session.getHistory === 'function') {
          const history = session.getHistory();
          result = history.length ? history[history.length - 1]?.content : undefined;
        }
        return { ok: true, result, sessionId: opts.sessionId };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), sessionId: opts.sessionId };
      } finally {
        try {
          session?.dispose();
        } catch {
          /* best-effort */
        }
      }
    });
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
      if (entry.spaceId) continue; // space-bound sessions belong to listSpaceSessions
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
   * List persisted chat sessions for a single project space
   * (`<root>/<projectId>/spaces/<spaceId>/sessions/`), overlaid with live status
   * where applicable. Mirrors {@link listProjectSessions}; newest-first.
   */
  async listSpaceSessions(projectId: string, spaceId: string): Promise<PersistedSessionMeta[]> {
    const root = this.requireRoot();
    const safeProj = safeProjectId(projectId);
    if (!safeProj) throw new Error(`invalid project id: ${projectId}`);
    const safeSpace = safeProjectId(spaceId);
    if (!safeSpace) throw new Error(`invalid space id: ${spaceId}`);
    const persisted = await listSpaceSessions(root, safeProj, safeSpace);

    // Overlay live status for any of these sessions currently in memory.
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

    // Add live space sessions not yet persisted (created, no message sent yet).
    for (const [, entry] of this.sessions) {
      if (entry.projectId !== safeProj || entry.spaceId !== safeSpace) continue;
      if (result.some((m) => m.sessionId === entry.sessionId)) continue;
      result.unshift({
        sessionId: entry.sessionId,
        projectId: safeProj,
        agentSlug: entry.agentSlug,
        spaceDir: entry.spaceDir,
        spaceId: safeSpace,
        title: entry.title ?? '',
        slug: entry.slug,
        createdAt: entry.createdAt,
        lastActivity: entry.lastActivity,
        messageCount: entry.messageCount,
        status: entry.status,
        totalCostUsd: entry.totalCostUsd > 0 ? entry.totalCostUsd : undefined,
      });
    }

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
 * Parse a project-relative `spaceRef` (`space/agent`, e.g. `curation/curator`)
 * into its `space` basename and optional `agent` segment. Extra path segments
 * are ignored. `space` falls back to the whole ref when there is no separator.
 */
function parseSpaceRef(spaceRef: string): { space: string; agent?: string } {
  const parts = spaceRef.split('/').filter(Boolean);
  return { space: parts[0] ?? spaceRef, agent: parts[1] };
}

/**
 * Resolve a space's default agent slug (its first declared agent) when a
 * `spaceRef` omits the `/agent` segment. Returns undefined if the space can't be
 * loaded or declares no agents (callers fall back to their own default).
 */
async function resolveDefaultAgent(spaceDir: string): Promise<string | undefined> {
  try {
    const space = await loadSpace(spaceDir, { requireAgents: false });
    return Object.keys(space.agents)[0];
  } catch {
    return undefined;
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

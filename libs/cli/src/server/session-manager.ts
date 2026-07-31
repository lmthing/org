import { randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Session, saveSnapshot, loadSpace, loadProjectFunctions, ForkEngine, runTasklist, Tracer, createAskConsentPrompter } from '@lmthing/core';
import type { StreamOpts, StreamSession, AppGlobalImpls, ConnectionResolver, ReadDocumentResult, TraceAttachment, UserInput, ProjectFunctions, TaskEnvelope, ProjectResult, DbTableSchema, TeamResolver } from '@lmthing/core';
import { createConnectionResolver } from './connections.js';
import { createCodeNodeCtxFactory } from './tasklist-runner.js';
import { loadAzurePrices, computeTurnCost, type ModelPricing } from './pricing.js';
import { SessionLedger } from './session-ledger.js';
import { emitInternalSignal } from './internal-signals.js';
import { integrationStatusFor } from './routes/store-spaces.js';
import { createStoreResolver } from './store-resolver.js';
import { createEmitEventResolver, type ManualEmitDepth } from './emit-event.js';
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
  extractPdfPageImages,
  resolveUploadDocument,
  recordUploadChannel,
  type AttachmentRef,
  type UploadMeta,
} from './uploads.js';
import { bootProjectApp } from '../app/boot.js';
import { loadProjectApp } from '../app/loader.js';
import { createApiRuntime, type ApiRuntime } from '../app/api/runtime.js';
import type { ProjectDb } from '../app/store.js';
import { createProjectAuthoringGlobals, type ProjectAuthoringGlobals } from '../app/authoring/index.js';
import { generateProjectContracts, type ProjectContracts } from '../app/build/contracts.js';
import { runProjectAppCheck } from '../app/build/check.js';
import { loadAllHooks } from '../app/hooks/index.js';
import { ProjectHookRuntime } from '../app/hooks/runtime.js';
import { scanEmitterDefs } from './emitter-manifests.js';
import { WebRenderHost } from '../rpc/server.js';
import { TraceHub } from '../rpc/trace-hub.js';
import {
  DEFAULT_PROJECT_ID,
  SYSTEM_PROJECT_ID,
  safeProjectId,
  createProjectSync,
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
  /** On a TEAM pod, the member who opened this session. Absent on a personal
   *  pod, where every session belongs to the pod's only user. Lets the session
   *  routes keep one member out of another's conversation. */
  ownerId?: string;
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
  /** Withhold every WRITE capability for this session, whatever the agent holds —
   *  see `SessionOpts.readOnly`. Set for a team-channel turn started by a viewer. */
  readOnly?: boolean;
  /** Optional NDJSON trace file (headless runs may want a trace on disk). */
  traceFile?: string;
  /** Override the always-loaded system space dirs (absolute paths). */
  systemSpaceDirs?: string[];
  /** Absolute space dirs pre-loaded into dynamicSpaces at start. */
  preloadSpaceDirs?: string[];
  /** Absolute path to the project's spaces/ dir; exposed to VMs as env. */
  projectSpacesDir?: string;
  /** The project's `functions/*.ts` (third function scope), loaded from
   *  `<projectRoot>/functions/` and injected into the project-rooted session +
   *  its forks. Original TS source + esbuild-bundled ESM (when the project has
   *  node_modules). Absent for legacy (non-project) sessions. */
  projectFunctions?: Record<string, string>;
  projectFunctionsBundled?: Record<string, string>;
  /** True for INTERACTIVE sessions (create/resume — a client answers asks over
   *  the WS). Gates the consent prompter (plan S10): headless runs leave this
   *  unset so consent-marked calls fail closed instead of hanging on an ask
   *  no client will ever answer. */
  interactive?: boolean;
  /**
   * A human will READ this turn's output, even though nobody can answer an
   * `ask()`. True for a THING run in a team channel: several people are watching
   * the thread, but there is no client wired to answer a prompt.
   *
   * Separate from {@link interactive} because those are two different
   * capabilities that happened to share a flag. `interactive` grants the consent
   * prompter, which needs someone to ANSWER; the anti-silent guard needs only
   * someone to WATCH. Conflating them meant a channel turn that did work and
   * displayed nothing settled `done` in silence — nothing nudged it, so THING
   * "replied" with whatever the run happened to leave behind.
   */
  visibleToUser?: boolean;
  /** This session's id. When set on a project-rooted build, `defaultBuildSession`
   *  registers the session's live app-build-target holder in `buildTargets` under this
   *  key so {@link SessionManager.persistSession} can persist it (and a later resume
   *  restore it). Omitted for headless/legacy builders that never retarget. */
  sessionId?: string;
  /** Seed for the live app-build target on a RE-ESTABLISH (resume). When set,
   *  `defaultBuildSession` seeds the build-target holder to this project id instead of
   *  the session's own `projectId`, so a delegated app build resumes into the SAME live
   *  project THING originally created. Restored from `PersistedSessionMeta.buildTargetProjectId`. */
  initialBuildTargetProjectId?: string;
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

/**
 * What a headless turn hands back — `runHeadless` and `runHeadlessThreaded`
 * return the same shape.
 *
 * `result` is the turn's single answer: the LAST `display()` descriptor, or the
 * final history entry when the agent displayed nothing. `displays` is EVERY
 * descriptor the turn emitted, in order, for a caller that renders the whole
 * answer rather than summarising it — a channel post is a transcript, and an
 * agent that displays a heading and then a table has said both things.
 */
export interface HeadlessRunResult {
  ok: boolean;
  result?: unknown;
  /** Every `display()` of the turn, in order. Empty on a failed turn. */
  displays?: unknown[];
  error?: string;
  sessionId: string;
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
/**
 * How many model forks may run at once — read from the pod env the gateway sets.
 *
 * Falls back to 4, which is what this was hardcoded to. See
 * `cloud/gateway/src/lib/compute.ts#memoryBudget`: the fan-out is one of three terms divided out of
 * the pod's memory limit, because each concurrent fork holds its own off-heap QuickJS arena.
 */
function maxConcurrentForksFromEnv(): number {
  const n = Number(process.env['LM_MAX_CONCURRENT_FORKS']);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

export class SessionManager {
  private sessions: Map<string, SessionEntry> = new Map();
  /** Per-session LIVE app-build-target holder, keyed by sessionId. The SAME object a
   *  project session's `createProject`/`selectProject`/`resolveBuildTarget` close over in
   *  {@link defaultBuildSession}, kept here so {@link persistSession} can persist its
   *  `projectId` and a resume re-seed it — making the retargeted build target durable
   *  across a session re-establish (was in-RAM only, lost on resume/eviction). */
  private buildTargets: Map<string, { projectId: string }> = new Map();
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
  /** Republish-on-write callable (S9), injected by `serve.ts` at boot once it knows
   *  the server port + gateway config. Invoked after installs (serve.ts callback) and
   *  authoring writes (S11 calls {@link republish}). Absent under bare `lmthing serve`
   *  wiring that never sets it — then {@link republish} is a no-op. */
  private republishFn?: () => Promise<void>;
  /** Drop `serve.ts`'s cached page bundle for a project (injected at boot, like
   *  {@link republishFn}). The served bundle is cached for the server's LIFETIME, so an
   *  authored page/api write must invalidate it or the app keeps serving the old build —
   *  see {@link onAppWrite}. */
  private invalidatePageBuildFn?: (projectId: string) => void;
  private reaper: ReturnType<typeof setInterval> | null = null;
  /** Absolute path to `<cwd>/.lmthing` — set when running in project mode. */
  readonly lmthingRoot?: string;
  /** Per-model pricing loaded from prices/azure.json at startup. */
  private prices: Record<string, ModelPricing> = loadAzurePrices();
  /** Pod-global ledger of every session (chat + hook/code-node) and its delegates,
   *  with token/cost accounting. Persisted to `<lmthingRoot>/sessions-ledger.jsonl`
   *  when project-mode; file-less (in-memory) otherwise. */
  private sessionLedger: SessionLedger;

  constructor(opts: SessionManagerOpts) {
    this.streamFn = opts.streamFn;
    this.defaultSpaceDir = opts.defaultSpaceDir;
    this.defaultModelAlias = opts.defaultModelAlias;
    // A whole-app build fans out into many concurrent sub-sessions (per-specialist research +
    // scaffold + the app builder), so the resident cap must clear that headroom or the top-level
    // turn gets starved/evicted mid-build. The P3 memory watchdog still sheds idle sessions under
    // real pressure, so the ceiling is safe to raise. Override with MAX_SESSIONS.
    this.maxSessions = opts.maxSessions ?? (Number(process.env['MAX_SESSIONS']) || 24);
    this.snapshotsDir = opts.snapshotsDir ?? process.env['SNAPSHOTS_DIR'] ?? '/data/snapshots';
    this.idleTtlMs = opts.idleTtlMs ?? Number(process.env['IDLE_TTL_MINUTES'] ?? 15) * 60000;
    this.buildSessionFn = opts.buildSession ?? this.defaultBuildSession.bind(this);
    this.lmthingRoot = opts.lmthingRoot;
    this.sessionLedger = new SessionLedger(
      this.lmthingRoot ? join(this.lmthingRoot, 'sessions-ledger.jsonl') : null,
      this.prices,
    );
  }

  /** Newest-first snapshot of the session/delegate ledger (for the settings UI). */
  listSessionLedger(limit = 200): ReturnType<SessionLedger['list']> {
    return this.sessionLedger.list(limit);
  }

  /** Subscribe a session's tracer to its hub AND cost accumulation. */
  private wireTracer(session: Session, entry: SessionEntry): void {
    if (typeof session.getTracer !== 'function') return;
    // Record this chat session + its delegates in the pod-global ledger.
    this.sessionLedger.trackTracer(session.getTracer(), {
      source: 'chat',
      sessionId: entry.sessionId,
      ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
    });
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

  /** Wire the republish-on-write callable (S9). Called once from `serve.ts` at boot. */
  setRepublish(fn: () => Promise<void>): void {
    this.republishFn = fn;
  }

  /** Wire the page-build cache invalidator. Called once from `serve.ts` at boot (it owns
   *  the cache). No-op under wiring that never sets it. */
  setInvalidatePageBuild(fn: (projectId: string) => void): void {
    this.invalidatePageBuildFn = fn;
  }

  /** Re-derive the pod's runtime-published artifacts (webhook manifest + crontab +
   *  emitter scan cache) after an authoring write. No-op when no republish callable
   *  was wired. TODO(S11): the automator/engineer authoring globals call this after
   *  writing a project hook/event/function so the change goes live without a restart. */
  async republish(): Promise<void> {
    if (this.republishFn) await this.republishFn();
  }


  /** Pod-side resolver for the universal `readDocument` global — extract a stored
   *  upload's content Node-side (see {@link resolveUploadDocument}). Attached to
   *  EVERY session (project-independent). */
  private resolveDocument(attachmentId: string, opts?: { maxChars?: number }): Promise<ReadDocumentResult> {
    return resolveUploadDocument(this.uploadsDir, attachmentId, opts);
  }

  /** Pod-wide manual-emit chain depth (plan S10) — SHARED across all sessions so
   *  a manual emit whose subscriber's headless run emits again (a different
   *  session's resolver) still counts as one deepening chain. Lockstep with
   *  `HOOK_DEPTH_CAP` inside {@link createEmitEventResolver}. */
  private manualEmitDepth: ManualEmitDepth = { value: 0 };

  /** Fold the store + manual-emit resolvers (plan S10) into a project-rooted
   *  session's app globals — mirroring {@link withConnections}: the resolvers ride
   *  `AppGlobalImpls` so delegates/forks inherit them, while injection of the
   *  agent-facing globals stays capability-gated (`store:read`/`store:install`/
   *  `events:emit`) in core's bootstrap. Sessions outside a project get neither
   *  (the yield router then errors clearly). */
  private withStore(appGlobals: AppGlobalImpls | undefined, projectId?: string): AppGlobalImpls | undefined {
    const root = this.lmthingRoot;
    if (!root || !projectId) return appGlobals;
    return {
      ...appGlobals,
      store:
        appGlobals?.store ??
        createStoreResolver({
          root,
          projectId,
          republish: () => this.republish(),
          // Same side effects as the HTTP install route's callback (serve.ts):
          // the S8 space.installed signal. (The page-build cache lives in serve.ts;
          // republish() already refreshes the manifest/crontab/emitter caches.)
          onInstalled: (pid, spaceId) =>
            emitInternalSignal('space.installed', { projectId: pid, ...(spaceId ? { spaceId } : {}) }),
        }),
      emitEvent:
        appGlobals?.emitEvent ??
        createEmitEventResolver({ root, projectId, manager: this, depth: this.manualEmitDepth }),
    };
  }

  /** Default session builder — constructs a Session bound to `streamFn`. */
  private defaultBuildSession(args: BuildSessionArgs): Session {
    // ── Per-session app-BUILD TARGET (plan: LIVE-project delegated build) ────────
    // THING creates a LIVE project and delegates the app build INTO it. The live
    // `createProject`/`selectProject` globals move a per-session build target off the
    // session's own project; a delegate then resolves `resolveBuildTarget()` at delegate
    // time and builds into the target's roots + appGlobals (null ⇒ its own project).
    // Only a project-rooted session WITH app globals gets these — a legacy/headless
    // session (no projectId / no appGlobals / no lmthingRoot) leaves both unset.
    let appGlobals = args.appGlobals;
    // Typed via the exported SessionOpts field so we never depend on a standalone
    // `DelegateProjectContext` re-export from the core barrel.
    let resolveBuildTarget: import('@lmthing/core').SessionOpts['resolveBuildTarget'];
    const projectId = args.projectId;
    const root = this.lmthingRoot;
    if (projectId && args.projectRoot && appGlobals && root) {
      // create/select + resolveBuildTarget MUST close over the SAME holder. On a
      // RE-ESTABLISH (resume) `initialBuildTargetProjectId` re-seeds it to the live
      // project THING originally retargeted to (persisted in meta), so the delegated
      // build resumes into that project rather than silently falling back to its own.
      const buildTarget = { projectId: args.initialBuildTargetProjectId ?? projectId };
      // Register the holder so persistSession can persist buildTarget.projectId (and a
      // later resume restore it). Keyed by sessionId; absent for headless/legacy builders.
      if (args.sessionId) this.buildTargets.set(args.sessionId, buildTarget);
      const liveCreateProject = (name: string): ProjectResult => {
        try {
          const meta = createProjectSync(root, name);
          // A brand-new project is the signal's SUBJECT, not its audience → fanOutAll.
          emitInternalSignal('project.created', { projectId: meta.id }, { fanOutAll: true });
          buildTarget.projectId = meta.id;
          return { ok: true, appId: meta.id, root: join(root, meta.id) };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      };
      const liveSelectProject = (id: string): ProjectResult => {
        const safe = safeProjectId(id);
        if (!safe || !existsSync(join(root, safe, 'project.json'))) {
          return { ok: false, error: `no such project: ${id}` };
        }
        buildTarget.projectId = safe;
        return { ok: true, appId: safe, root: join(root, safe) };
      };
      appGlobals = { ...appGlobals, createProject: liveCreateProject, selectProject: liveSelectProject };
      resolveBuildTarget = async () => {
        if (buildTarget.projectId === projectId) return null; // no retarget — build into own project
        const targetRoot = join(root, buildTarget.projectId);
        const appG = await this.getProjectAppGlobals(root, buildTarget.projectId);
        return {
          projectId: buildTarget.projectId,
          projectRoot: targetRoot,
          projectSpacesDir: join(targetRoot, 'spaces'),
          appGlobals: appG,
          // Rebind the code-node factory to the TARGET too, so a code node's `writeProjectFile` /
          // `writeProject*` land in the project the agent nodes are writing into — not THING's
          // own `user` project. Without this `emit_types` wrote the contract to the wrong project.
          codeNodeCtxFactory: this.buildCodeNodeCtxFactory(root, buildTarget.projectId, targetRoot),
        };
      };
    }
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
        projectFunctions: args.projectFunctions,
        projectFunctionsBundled: args.projectFunctionsBundled,
        projectId: args.projectId,
        projectRoot: args.projectRoot,
        appGlobals: this.withStore(this.withConnections(appGlobals, args.projectRoot), args.projectId),
        resolveBuildTarget,
        appDts: args.appDts,
        // Schema-gated db.* (core composeDbDts). Initial schema for the first bake + the
        // targeted-freshness hooks: `dbSchemaRevision` (cheap counter read each turn) and
        // `resolveDbSchema` (re-derive only when it moved). Both read the maps populated by
        // getProjectDb at boot/reload; keyed by this session's projectId (undefined ⇒ loose).
        dbSchema: projectId ? this.projectDbSchemas.get(projectId) : undefined,
        dbSchemaRevision: () => (projectId ? this.projectDbSchemaRev.get(projectId) ?? 0 : 0),
        resolveDbSchema: () => (projectId ? this.projectDbSchemas.get(projectId) : undefined),
        documentResolver: (id, opts) => this.resolveDocument(id, opts),
        // Consent gate (plan S10): ONLY interactive sessions get a prompter (the
        // consent card rides renderHost.ask → the ask_start WS event). Headless
        // runs leave it unset so consent-marked calls FAIL CLOSED instead of
        // hanging on an ask with no client attached.
        consentPrompter: args.interactive ? createAskConsentPrompter(args.renderHost) : undefined,
        // Gates the turn loop's anti-silent no-visible-output guard, which asks
        // "will a human read this?" — NOT "can a human answer an ask?". A team
        // channel is the case that separates them: several people are watching the
        // thread, and none of them can answer a prompt. Hooks, webhooks, code-node
        // runs and spawns set neither and stay unguarded, which is right: nobody is
        // reading those, and they legitimately never display.
        interactive: args.interactive === true || args.visibleToUser === true,
        // Presence-only integration config status (S13) — reads the installed space's
        // required env-var NAMES vs `process.env`, never any secret values. Only a
        // project-rooted session (THING) gets it; absent ⇒ the yield errors clearly.
        integrationStatusResolver: args.projectRoot
          ? (spaceId: string) => integrationStatusFor(args.projectRoot as string, spaceId)
          : undefined,
        // Code-node runner (S9) so a project agent's `tasklist()` yield can run a
        // SPACE tasklist that contains `kind:'code'` nodes. Session-wide; the
        // factory derives each node's connection gate from its module path, so it
        // works for whichever tasklist the agent runs. Only project-rooted sessions
        // get it — a legacy/bare session leaves it unset (code nodes fail clearly).
        codeNodeCtxFactory:
          args.projectRoot && args.projectId && this.lmthingRoot
            ? this.buildCodeNodeCtxFactory(this.lmthingRoot, args.projectId, args.projectRoot)
            : undefined,
      },
      { streamFn: this.streamFn },
    );
  }

  /** Build the {@link createCodeNodeCtxFactory} deps for a project — shared by the
   *  interactive session path ({@link defaultBuildSession}) and the headless runner
   *  ({@link runTasklistHeadless}). db resolves lazily (a session may be built
   *  before its db boots); `delegate` runs a headless agent; `callConnection` is
   *  gated inside the factory by the tasklist's declared connections ∩ the space's
   *  own provider(s). */
  private buildCodeNodeCtxFactory(root: string, projectId: string, projectRoot: string): ReturnType<typeof createCodeNodeCtxFactory> {
    return createCodeNodeCtxFactory({
      getDb: () => this.getProjectDb(root, projectId),
      delegate: (spaceRef, action, opts) => this.codeNodeDelegate(projectId, spaceRef, action, opts),
      connectionResolver: this.getConnectionResolver(projectRoot),
      // Give CODE nodes the SAME typed live-project writers the agent nodes hold, so an
      // implement_* node can deterministically author tables/endpoints/pages/components.
      // `callProjectApi` rides in on this object rather than as its own factory dep: the worker
      // proxy protocol has a FIXED `ProxyKind` union with no `apiCall` member, and the worker's
      // method list is derived from `Object.keys(handlers.authoring)` — so a top-level handler key
      // would be silently dropped, while an authoring key surfaces on `ctx` automatically.
      projectAuthoring: this.buildProjectAuthoring(root, projectId),
    });
  }

  /** Build this project's typed live-project authoring writers, bound to its dir, with the
   *  republish / db-reload+seed / page-and-api cache-invalidation side effects fired after each
   *  write. Shared by {@link getProjectAppGlobals} (agent nodes) and {@link buildCodeNodeCtxFactory}
   *  (code nodes) so both paths land identical writes + re-derives. */
  private buildProjectAuthoring(root: string, projectId: string): ProjectAuthoringGlobals {
    return createProjectAuthoringGlobals({
      projectRoot: join(root, projectId),
      // Lets a code node PROVE an endpoint works instead of inferring it from a clean compile.
      // Resolved per call (not captured) so a node that runs right after `implement_endpoints`
      // sees the runtime rebuilt around the handlers this run just wrote.
      callProjectApi: async (name, input) => {
        const rt = await this.getApiRuntime(root, projectId);
        if (!rt) throw new Error(`callProjectApi("${name}"): project "${projectId}" has no api/ runtime`);
        return rt.callByName(name, input);
      },
      republish: () => {
        // Fire-and-forget from the synchronous writer; a republish failure never fails
        // the write (the file already landed — the next boot picks it up regardless).
        void this.republish().catch((err) =>
          console.warn(`[authoring] republish after project write failed: ${err instanceof Error ? err.message : String(err)}`),
        );
        // A newly authored hook must ALSO join the live db-write dispatch set. That wiring
        // happens once, when the project's db first boots — so without this refresh a hook
        // written AFTER the db booted never fires on a db write until the pod restarts.
        void this.refreshProjectHooks(root, projectId).catch((err) =>
          console.warn(`[authoring] hook refresh failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      },
      onSchemaWrite: (table, rows) => {
        // A project with no `database/*.json` boots NO db at all (bootProjectApp → null),
        // and that `null` is CACHED. The first authored table must drop the cached "no db"
        // so the next getProjectDb() actually boots one. When the authoring agent passed seed
        // `rows` (moving KNOWN data into the app — e.g. a trip's flights/hotels from a file it
        // was given), insert them AFTER the reload: the agent itself cannot, because `db` is not
        // injected into its session until a table already exists.
        void this.reloadProjectDb(root, projectId)
          .then(() => (rows && rows.length ? this.seedProjectTable(root, projectId, table, rows) : undefined))
          .catch((err) =>
            console.warn(`[authoring] project db reload/seed failed: ${err instanceof Error ? err.message : String(err)}`),
          );
      },
      onAppWrite: (kind) => {
        // A live page/api write must invalidate the caches derived from `api/` + `pages/`:
        // the typed endpoint contracts (feed the manifest + apiCall DTS) and the per-project
        // api runtime (loads the handlers). Dropping them makes the next manifest/apiCall
        // re-derive from the new files. (`kind` is 'api' | 'page'; both invalidate the same.)
        void kind;
        this.projectContracts.delete(projectId);
        const rt = this.apiRuntimes.get(projectId);
        if (rt) {
          try {
            rt.dispose();
          } catch {
            /* best-effort */
          }
        }
        this.apiRuntimes.delete(projectId);
        // …AND the SERVED bundle, which is cached for the server's lifetime (serve.ts's
        // `pageBuildCache`). Without this the app keeps serving the pre-write build: the user
        // asks the in-app assistant for a new page, the agent writes it, and the running app
        // shows "No page for /favorites" — the self-evolution never lands. Worse, once anything
        // DOES rebuild (the automator's `POST /app/build`), the fresh index.html references a
        // new hashed entry that the STALE manifest does not contain, so the asset request falls
        // through to the SPA shell and the app goes BLANK. Found live in scenario 10, driving
        // the in-app dock in a real browser. The next page request re-derives the bundle.
        this.invalidatePageBuildFn?.(projectId);
      },
    });
  }

  /** A code node's `ctx.delegate(spaceRef, action?, opts?)` — run a headless agent
   *  and return its {@link runHeadless} result (mirrors the hook ctx delegate:
   *  `opts.input` rides into the kickoff seed, `opts.message` overrides the text). */
  private codeNodeDelegate(projectId: string, spaceRef: string, action?: string, opts?: unknown): Promise<unknown> {
    const agentSlug = spaceRef.split('/').pop() ?? spaceRef;
    // S8 instrumentation: server-side delegation seam (code nodes + tasklist
    // delegateRunner funnel here). In-session `delegate()` yields are separate
    // (core yield-router) and are NOT instrumented in this step.
    emitInternalSignal('agent.delegated', { projectId, from: 'code-node', to: spaceRef + (action ? `#${action}` : '') });
    const dopts = opts as { input?: unknown; message?: string } | undefined;
    const base = `Code-node delegate to "${spaceRef}"` + (action ? ` — "${action}".` : '.');
    const message =
      (dopts?.message ?? base) + (dopts?.input !== undefined ? `\nInput: ${safeStringify(dopts.input)}` : '');
    return this.runHeadless({ projectId, spaceRef, agentSlug, message, origin: { source: 'code-node' } });
  }

  /** Per-project app-db cache. Lazily boots (restore→open→reconcile, fail-loud on
   *  non-additive schema drift) on first use and reuses the handle across sessions in
   *  that project; `null` is cached for spaces-only projects (e.g. `system`) so we don't
   *  re-probe every session. Closed in {@link closeProjectDbs} on shutdown. */
  private projectDbs = new Map<string, ProjectDb | null>();

  /** Per-project DECLARED DB schema (table + column names from `database/*.json`) used to gate
   *  `db.*` at typecheck (core `composeDbDts`). Derived from the SAME boot pass as {@link projectDbs}
   *  (below) so a hallucinated table / typo'd column fails typecheck instead of throwing at runtime.
   *  `projectDbSchemaRev` bumps on every (re)boot — the session reads it each turn (cheap) and
   *  re-bakes its ambient DTS ONLY when it moved (a `writeProjectTable`/`createTable` landed →
   *  {@link reloadProjectDb} → {@link getProjectDb}), so a table created in one turn is queryable
   *  (typechecks) in the next. */
  private projectDbSchemas = new Map<string, DbTableSchema[]>();
  private projectDbSchemaRev = new Map<string, number>();

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
      await this.refreshProjectDbSchema(root, projectId);
      if (db) await this.ensureProjectHookRuntime(root, projectId, db);
    }
    return db;
  }

  /**
   * Re-derive the project's DECLARED schema (`database/*.json` basenames + column keys) into
   * {@link projectDbSchemas} and bump {@link projectDbSchemaRev}. Called from {@link getProjectDb}
   * on every (re)boot — so boot AND {@link reloadProjectDb} (which funnels through getProjectDb
   * after an authoring table write) both refresh it. Cheap (one readdir + small JSON reads, the
   * same files boot already read — NOT `ts-json-schema-generator`); best-effort (an unreadable/
   * mid-write schema leaves an empty list ⇒ the loose `string`-typed db DTS, never a crash).
   */
  private async refreshProjectDbSchema(root: string, projectId: string): Promise<void> {
    let schema: DbTableSchema[] = [];
    try {
      const app = await loadProjectApp(join(root, projectId));
      schema = app.tables.map((t) => ({ name: t.name, columns: Object.keys(t.schema.columns) }));
    } catch {
      schema = [];
    }
    this.projectDbSchemas.set(projectId, schema);
    this.projectDbSchemaRev.set(projectId, (this.projectDbSchemaRev.get(projectId) ?? 0) + 1);
  }

  /**
   * Wire (once) the project's DB-write → EVENT dispatch onto the db's `onWrite` seam. A db
   * write produces the synthetic `project/db.<table>.<event>` event (consumed by EVENT hooks)
   * plus any `{type:'db'}` emitter def's events, so the runtime is only worth wiring when the
   * project HAS an event hook (project or space) or a db emitter def.
   *
   * Called at db boot AND from {@link refreshProjectHooks} after an authoring write. Both are
   * needed: an app's db boots when its FIRST TABLE is authored, which is necessarily before
   * its first hook exists — so wiring only at boot would leave a later-authored hook dead
   * until the pod restarted (the S10 Act III "the form is alive" failure: the intake row
   * landed, `normalize-recipe-intake` never ran, and the normalized recipe never appeared).
   */
  private async ensureProjectHookRuntime(
    root: string,
    projectId: string,
    db: ProjectDb,
  ): Promise<ProjectHookRuntime | undefined> {
    const existing = this.projectHookRuntimes.get(projectId);
    if (existing) return existing;
    try {
      const hooks = await loadAllHooks(join(root, projectId));
      const hasEventHook = hooks.some((h) => (h.def as { type?: string }).type === 'event');
      let hasDbEmitter = false;
      try {
        const { scopes } = await scanEmitterDefs(root, projectId);
        hasDbEmitter = Object.values(scopes).some((s) => s.defs.some((d) => d.def.type === 'db'));
      } catch {
        /* scan failure ⇒ treat as no db emitters (fail-soft) */
      }
      if (!hasEventHook && !hasDbEmitter) return undefined;
      const rt = new ProjectHookRuntime(projectId, root, this, db, hooks);
      this.projectHookRuntimes.set(projectId, rt);
      return rt;
    } catch (err) {
      console.warn(
        `[hooks] failed to wire db-write event dispatch for "${projectId}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /** Stable, per-project `db` handles that forward every verb to whatever db is
   *  CURRENTLY booted for the project (the {@link projectDbs} cache) — see
   *  {@link liveProjectDb}. */
  private liveDbProxies = new Map<string, ProjectDb['db']>();

  /**
   * A STABLE `db` handle bound to a project, forwarding each verb to whatever db is
   * booted for it AT CALL TIME (the {@link projectDbs} cache).
   *
   * This is what lets a long-lived INTERACTIVE session (THING) expose a working `db`
   * to its DELEGATES. THING's `appGlobals` is built ONCE — at project open, when the
   * app usually has no tables yet, so {@link getProjectDb} returns `null`. A delegate
   * (e.g. the automator) inherits the parent's `appGlobals` and injects `db` at
   * child-VM creation, reading `impls.db` THEN. A static `db.db` snapshot would freeze
   * that `null`, so an automator delegated AFTER the first table was authored (which
   * reboots the cached db) would still find no `db` and fail a row update with
   * `'db' is not defined` (S06 Act V). A forwarder read at injection time always
   * reflects the live db. It is also why `db` is now injected on the CAPABILITY grant
   * alone (matching the DTS, which declares `db` from `db:*` regardless of tables) —
   * `impls.db` is always present; the verbs throw a clear error, not a ReferenceError,
   * when the project genuinely has no database yet.
   */
  private liveProjectDb(projectId: string): ProjectDb['db'] {
    const existing = this.liveDbProxies.get(projectId);
    if (existing) return existing;
    const live = (): ProjectDb['db'] => {
      const pdb = this.projectDbs.get(projectId);
      if (!pdb) {
        throw new Error(
          `project "${projectId}" has no database yet — author a table first ` +
            `(writeProjectTable), then the db verbs become available`,
        );
      }
      return pdb.db;
    };
    const proxy: ProjectDb['db'] = {
      query: (t, o) => live().query(t, o),
      // The natural "what exists?" probe: answer [] for a db-less project rather than
      // throw, so a caller can branch on it safely (never a ReferenceError).
      tables: () => this.projectDbs.get(projectId)?.db.tables() ?? [],
      insert: (t, v) => live().insert(t, v),
      update: (t, o) => live().update(t, o),
      remove: (t, o) => live().remove(t, o),
      createTable: (s) => live().createTable(s),
      addColumn: (t, n, c) => live().addColumn(t, n, c),
    };
    this.liveDbProxies.set(projectId, proxy);
    return proxy;
  }

  private async getProjectAppGlobals(root: string, projectId: string): Promise<AppGlobalImpls | undefined> {
    // Warm the db cache + wire the db-write→event dispatch runtime (side effects). The
    // returned `db` is the live forwarder, not this snapshot — see {@link liveProjectDb}.
    await this.getProjectDb(root, projectId);
    const apiRt = await this.getApiRuntime(root, projectId);
    // LIVE-PROJECT authoring writers (S11) — bound to THIS project's own dir (not the
    // catalog), republishing after each write so the new event hook / emitter def /
    // crontab goes live without a pod restart. Injected only on `hooks:write` (core's
    // injectAppGlobals), so THING/ordinary agents never see them; the automator writes
    // hooks+events, the engineer writes functions.
    const projectAuthoring = this.buildProjectAuthoring(root, projectId);
    return {
      // Live forwarder (NOT a build-time snapshot): reflects whatever db is booted for
      // the project when a session/delegate injects it. Present on the CAPABILITY grant
      // alone — matching the DTS — so a db-granted delegate always finds `db`.
      db: this.liveProjectDb(projectId),
      // Agent-facing apiCall — re-enter the project's OWN api endpoints by name
      // (same runtime the browser + hooks use). Only present when the project has
      // an `api/` dir; the yield router rejects apiCall() otherwise.
      ...(apiRt ? { apiCall: (name: string, input?: unknown) => unwrapApiCall(apiRt, name, input) } : undefined),
      // Agent-facing buildApp — build + programmatically check THIS project's live app
      // (lint → typecheck → esbuild) and return the structured error list. The build gate
      // node calls it to drive the app to type-correct-or-fail-loud; a clean run is the
      // sole authoritative build (sets built:true for all routes). Bound to the project root.
      buildApp: () => runProjectAppCheck(join(root, projectId)),
      writeProjectHook: projectAuthoring.writeProjectHook,
      writeProjectEvent: projectAuthoring.writeProjectEvent,
      writeProjectFunction: projectAuthoring.writeProjectFunction,
      writeProjectTable: projectAuthoring.writeProjectTable,
      writeProjectPage: projectAuthoring.writeProjectPage,
      writeProjectComponent: projectAuthoring.writeProjectComponent,
      writeProjectView: projectAuthoring.writeProjectView,
      writeProjectViewComponent: projectAuthoring.writeProjectViewComponent,
      writeProjectViewShell: projectAuthoring.writeProjectViewShell,
      writeProjectApi: projectAuthoring.writeProjectApi,
      listProjectDir: projectAuthoring.listProjectDir,
      readProjectFile: projectAuthoring.readProjectFile,
    };
  }

  /**
   * Re-read the project's hooks into its live db-write dispatch runtime (after an
   * authoring write).
   *
   * When no runtime exists yet, WIRE one rather than no-op: the db boots with the project's
   * first table — always before its first hook is authored — so the boot-time wiring finds
   * nothing to subscribe and skips. Without wiring here, the hook the agent just wrote would
   * never see a db write until the pod restarted. No-op only while the project has no db at
   * all (a table write reloads it via {@link reloadProjectDb}, which re-wires from scratch).
   */
  private async refreshProjectHooks(root: string, projectId: string): Promise<void> {
    const rt = this.projectHookRuntimes.get(projectId);
    if (!rt) {
      const db = this.projectDbs.get(projectId);
      if (db) await this.ensureProjectHookRuntime(root, projectId, db);
      return;
    }
    rt.reload(await loadAllHooks(join(root, projectId)));
  }

  /**
   * Drop the cached project db (and its hook runtime) so the NEXT {@link getProjectDb}
   * re-derives both from `database/*.json`. Called after a live table write: the very
   * first table is what brings a db into existence for a project that had none (the
   * cached value is `null`), and boot's reconcile picks up an added table additively.
   *
   * An OPEN db handle is left open and simply re-booted around: `bootProjectApp` opens
   * the same file and reconciles, and the api runtime's handle stays valid.
   */
  private async reloadProjectDb(root: string, projectId: string): Promise<void> {
    const rt = this.projectHookRuntimes.get(projectId);
    if (rt) {
      rt.dispose();
      this.projectHookRuntimes.delete(projectId);
    }
    this.projectDbs.delete(projectId);
    await this.getProjectDb(root, projectId);
  }

  /**
   * Seed rows into a just-authored project table (the `rows` arg of `writeProjectTable`).
   *
   * This is the ONLY host-side data-in path for the authoring agent: it holds `db:schema`
   * (create tables) but the `db` global — through which it would insert — is not injected into
   * its session until the project already has a table, so it cannot insert into a table it just
   * created in the same turn. When the user hands the agent KNOWN data to "move into the app"
   * (a trip's flights + hotels from an attached file), the agent passes that data as
   * `writeProjectTable(name, schema, rows)` and the host inserts it here, after the db re-derives.
   *
   * Best-effort per row: a malformed row is skipped-with-warn rather than failing the whole
   * authoring turn (the schema + the good rows already landed). Uses the same main-process async
   * db API the app's api/ handlers use, so every insert also emits `project/db.<table>.insert`.
   *
   * **Seeding is IDEMPOTENT.** An authoring agent can legitimately be asked for the same job more
   * than once — the caller retried, judged the first answer incomplete, or split one build across
   * several messages — and each run re-issues `writeProjectTable(name, schema, rows)` with the same
   * known data. Inserting blindly turned a household's four insurance policies into eight, and the
   * duplicate copy silently disagreed with the original (a €180/month premium came back annualized
   * as 2160). Duplicated rows are worse than missing ones: every count and total the app shows is
   * then wrong, and the user cannot tell which figure is true.
   *
   * So a row already in the table is SKIPPED. "Already there" means every column this seed row
   * supplies already matches an existing row — the `id` and any defaults the seed did not supply
   * are ignored, so a row seeded by an earlier run still matches. Rows accumulate as we go, so a
   * list that repeats a row within one call collapses too. This is a seed path (moving KNOWN data
   * in), not a log: two rows identical in every column the caller supplied are the same fact.
   */
  private async seedProjectTable(
    root: string,
    projectId: string,
    table: string,
    rows: unknown[],
  ): Promise<void> {
    const projectDb = await this.getProjectDb(root, projectId);
    if (!projectDb) {
      console.warn(`[authoring] seed skipped: project "${projectId}" has no db after authoring ${table}`);
      return;
    }
    /** Compare the way a person would: "€180" and 180 are the same premium. */
    const norm = (v: unknown): string =>
      v === null || v === undefined ? '' : String(v).trim().toLowerCase();
    /** Does `existing` already carry every column this seed row supplies? */
    const alreadyThere = (existing: Record<string, unknown>, seed: Record<string, unknown>): boolean =>
      Object.entries(seed).every(([col, val]) => norm(existing[col]) === norm(val));

    const present = (await projectDb.async
      .query(table, {})
      .catch(() => [] as Record<string, unknown>[])) as Record<string, unknown>[];

    let ok = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const seed = row as Record<string, unknown>;
      // An empty row would match every existing row — it carries no facts, so it seeds nothing.
      if (Object.keys(seed).length === 0) continue;
      if (present.some((e) => alreadyThere(e, seed))) {
        skipped++;
        continue;
      }
      try {
        await projectDb.async.insert(table, seed);
        present.push(seed);
        ok++;
      } catch (err) {
        console.warn(
          `[authoring] seed row into "${table}" failed (skipped): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    console.log(
      `[authoring] seeded ${ok}/${rows.length} row(s) into ${projectId}/${table}` +
        (skipped ? ` (${skipped} already present — re-seed skipped)` : ''),
    );
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

  /** Per-project cache of the project's `functions/` (third function scope),
   *  keyed by absolute project root. Loaded once (esbuild bundling can be heavy
   *  when the project ships node_modules) and reused across sessions in that
   *  project; a load failure caches an empty set so we don't re-probe every
   *  session. Republish-on-write (S9/S11) should invalidate via
   *  {@link invalidateProjectFunctions} after the engineer writes a function. */
  private projectFunctionsCache = new Map<string, ProjectFunctions>();

  async getProjectFunctions(projectRoot: string): Promise<ProjectFunctions> {
    let pf = this.projectFunctionsCache.get(projectRoot);
    if (!pf) {
      try {
        pf = await loadProjectFunctions(projectRoot);
      } catch (err) {
        console.warn(
          `[project-functions] failed to load for "${projectRoot}": ${err instanceof Error ? err.message : String(err)}`,
        );
        pf = { functions: {}, functionsBundled: {} };
      }
      this.projectFunctionsCache.set(projectRoot, pf);
    }
    return pf;
  }

  /** Drop the cached project functions for a root so the next session reloads
   *  `<projectRoot>/functions/` from disk (call after an authoring write). */
  invalidateProjectFunctions(projectRoot: string): void {
    this.projectFunctionsCache.delete(projectRoot);
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

    // Record the disposal on the session's trace BEFORE persisting (so it lands in the
    // snapshot) — diagnostic for a disposal that races an in-flight turn (see traceDispose).
    this.traceDispose(victim, 'evict');
    // Free the slot synchronously (so the immediate size check passes), then
    // persist + dispose in the background.
    const evicted = victim;
    this.sessions.delete(evicted.sessionId);
    this.sessionLedger.finalize(evicted.sessionId, 'done');
    console.warn(`[session-manager] evicted idle session ${evicted.sessionId} (persist-first)`);
    void (async () => {
      try { await this.persistSession(evicted); } catch { /* best-effort */ }
      try { evicted.session?.dispose(); } catch { /* best-effort */ }
      // Drop the live build-target holder AFTER persist (which reads it) so eviction
      // doesn't leak it; a reopen re-seeds a fresh holder from the persisted meta.
      this.buildTargets.delete(evicted.sessionId);
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
    /** TEAM pods: the member opening this session (from the verified caller). */
    ownerId?: string;
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
        ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
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
        ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
        snapshotDir,
      };
      this.sessions.set(sessionId, placeholderEntry);

      // Async init: resolve dirs then build the session.
      void this._initProjectSession(placeholderEntry, root, projectId, opts).catch((err: unknown) => {
        placeholderEntry.status = 'error';
        // Surface the init failure to the pod log — otherwise a session that dies during async init
        // (e.g. an app-db reconcile throw) leaves NO trace: the WebRenderHost's hub is only wired by
        // wireTracer AFTER buildSessionFn, so an error emitted here before that is swallowed entirely.
        // eslint-disable-next-line no-console
        console.error(`[session-init] session ${sessionId} (project "${projectId}") failed to initialize:`, err);
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
      interactive: true,
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
      ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
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
    const projectFunctions = await this.getProjectFunctions(join(root, projectId));
    const session = this.buildSessionFn({
      spaceDir,
      agentSlug,
      model: opts.model,
      budget: opts.budget,
      renderHost: entry.renderHost,
      systemSpaceDirs,
      preloadSpaceDirs,
      projectSpacesDir,
      projectFunctions: projectFunctions.functions,
      projectFunctionsBundled: projectFunctions.functionsBundled,
      projectId,
      projectRoot: join(root, projectId),
      appGlobals,
      appDts: contracts?.apiCallDts,
      interactive: true,
      sessionId: entry.sessionId,
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
    // The live app-build target THING retargeted to (if any), restored below and re-seeded
    // into the rebuilt session's holder so the delegated build survives this re-establish.
    let restoredBuildTargetProjectId: string | undefined;
    try {
      const raw = await readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw) as PersistedSessionMeta;
      entry.title = meta.title || undefined;
      entry.slug = meta.slug || undefined;
      entry.createdAt = meta.createdAt;
      entry.messageCount = meta.messageCount;
      entry.agentSlug = meta.agentSlug || entry.agentSlug;
      if (meta.totalCostUsd !== undefined) entry.totalCostUsd = meta.totalCostUsd;
      restoredBuildTargetProjectId = meta.buildTargetProjectId;
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
    const projectFunctions = await this.getProjectFunctions(join(root, projectId));
    const session = this.buildSessionFn({
      spaceDir,
      agentSlug,
      model: opts.model,
      budget: opts.budget,
      renderHost: entry.renderHost,
      systemSpaceDirs,
      preloadSpaceDirs,
      projectSpacesDir,
      projectFunctions: projectFunctions.functions,
      projectFunctionsBundled: projectFunctions.functionsBundled,
      projectId,
      projectRoot: join(root, projectId),
      appGlobals,
      appDts: contracts?.apiCallDts,
      interactive: true,
      sessionId: entry.sessionId,
      initialBuildTargetProjectId: restoredBuildTargetProjectId,
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

      // Persist the retargeted live app-build target so a resume re-seeds the holder.
      // Only when it moved OFF the session's own project (else the resolver builds into
      // its own project anyway — no need to persist, and no seed to restore).
      const bt = this.buildTargets.get(entry.sessionId);
      const buildTargetProjectId =
        bt && bt.projectId !== entry.projectId ? bt.projectId : undefined;

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
        buildTargetProjectId,
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
  async saveUpload(input: { bytes: Uint8Array; mediaType: string; filename?: string; ownerUserId?: string }): Promise<AttachmentRef> {
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
    // A PDF with NO text layer is a scan — a photograph of a document. Rasterize its
    // pages to real image uploads now, so the file has a way through the system at all:
    // as a plain document it carries no image part, so no vision model could ever see
    // it and the agent is left guessing. Best-effort: a failure just leaves it textless.
    let pages: string[] | undefined;
    if (kind === 'file' && input.mediaType === 'application/pdf' && !text) {
      try {
        const pageImages = await extractPdfPageImages(input.bytes);
        const saved = await Promise.all(
          pageImages.map((png, i) =>
            saveUploadToDisk(this.uploadsDir, {
              bytes: png,
              mediaType: 'image/png',
              filename: `${input.filename ?? 'scan'} — page ${i + 1}`,
              // A page image derived from someone's scan belongs to them too —
              // otherwise the pages of a private document are unowned and
              // therefore unguarded.
              ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
            }),
          ),
        );
        if (saved.length > 0) pages = saved.map((m) => m.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[uploads] scanned-PDF rasterization failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const meta = await saveUploadToDisk(this.uploadsDir, {
      ...input,
      ...(transcript ? { transcript } : {}),
      ...(text ? { text } : {}),
      ...(pages ? { pages } : {}),
    });
    return { ...meta, url: uploadUrl(meta.id) };
  }

  /** Read a stored upload's bytes + metadata for the serving route. */
  async readUpload(
    id: string,
  ): Promise<{ bytes: Uint8Array; mediaType: string; ownerUserId?: string; channelIds?: string[] } | null> {
    const meta = await readUploadMeta(this.uploadsDir, id);
    if (!meta) return null;
    const bytes = await readUploadBytes(this.uploadsDir, id);
    if (!bytes) return null;
    // The owner and the channels it has been shared into ride along so the serve
    // route can authorize without a second read.
    return {
      bytes,
      mediaType: meta.mediaType,
      ...(meta.ownerUserId ? { ownerUserId: meta.ownerUserId } : {}),
      ...(meta.channelIds?.length ? { channelIds: meta.channelIds } : {}),
    };
  }

  /** Read a stored upload's metadata (no bytes) — for a caller that needs to
   *  check ownership or build a client-facing attachment record without paying
   *  to read the file's content off disk. */
  async readUploadMeta(id: string): Promise<UploadMeta | null> {
    return readUploadMeta(this.uploadsDir, id);
  }

  /** Record that an upload was posted into a channel — see
   *  {@link recordUploadChannel}. Called by the channel message route AFTER it
   *  has verified the poster owns the upload. */
  async bindUploadToChannel(id: string, channelId: string): Promise<void> {
    await recordUploadChannel(this.uploadsDir, id, channelId);
  }

  /** Assemble the model input (text + image/file parts) and the trace-facing
   *  attachment list from stored uploads. Server-authoritative: only the id is
   *  trusted; bytes/metadata are re-read from disk. Audio contributes its
   *  transcript to the text (the model gets text, not the raw audio).
   *
   *  Public: the team-channel route reuses this SAME assembly (rather than a
   *  second mechanism) to hand THING a channel message's attachments — the
   *  identical path `sendMessage` already uses for `/chat`. */
  async assembleAttachments(
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
    // A SCANNED pdf carries no text and, as a document, no image part — so on its own it
    // is unreadable by every model in the system. Its pages were rasterized to image
    // uploads at save time: attach those alongside it, and the ordinary image → vision
    // path can simply look at the page.
    for (const { meta } of [...items]) {
      for (const pageId of meta?.pages ?? []) {
        const pageMeta = await readUploadMeta(this.uploadsDir, pageId);
        if (!pageMeta) continue;
        items.push({ meta: pageMeta, bytes: await readUploadBytes(this.uploadsDir, pageId) });
      }
    }
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
    // S8 instrumentation: top-level (interactive) turn lifecycle — one guarded
    // fire-and-forget line per edge; emitInternalSignal itself never throws.
    const turnStartedAt = Date.now();
    emitInternalSignal('session.started', { ...(entry.projectId ? { projectId: entry.projectId } : {}), agent: entry.agentSlug, sessionId: id });
    run
      .then(() => {
        entry.status = 'idle';
        entry.lastActivity = Date.now();
        entry.renderHost.emit({ type: 'done' });
        emitInternalSignal('session.completed', { ...(entry.projectId ? { projectId: entry.projectId } : {}), agent: entry.agentSlug, sessionId: id, ok: true, durationMs: Date.now() - turnStartedAt });
        void this.persistSession(entry);
      })
      .catch((err: unknown) => {
        entry.status = 'error';
        entry.lastActivity = Date.now();
        entry.renderHost.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        emitInternalSignal('session.completed', { ...(entry.projectId ? { projectId: entry.projectId } : {}), agent: entry.agentSlug, sessionId: id, ok: false, durationMs: Date.now() - turnStartedAt });
        void this.persistSession(entry);
      });
  }

  /**
   * Record an OUT-OF-BAND VM disposal as a `session_disposed` trace event on the session
   * (persisted to trace.json via {@link persistSession}). If the disposal races an in-flight
   * turn, that turn's resume throws the opaque QuickJS "Lifetime not alive" — this event is
   * the retained evidence that pins WHICH disposer (reaper / capacity/memory eviction /
   * explicit) fired and the session's `status` at the moment. The disposer's own console.warn
   * goes to server stderr, which run evidence discards; this survives in runs/<n>/ evidence.
   */
  private traceDispose(entry: SessionEntry, trigger: 'reaper' | 'evict' | 'explicit'): void {
    // Sink 1 (always): the server's stdout+stderr — captured to the run's `sessions.log`,
    // which run evidence RETAINS. Structured so grep pins the disposer + the status at kill.
    console.warn(`[session-manager] disposing session ${entry.sessionId} (trigger=${trigger}, status=${entry.status})`);
    // Sink 2 (when the session is live): a persisted `session_disposed` trace event, so a
    // disposal that races an in-flight turn is diagnosable from runs/<n>/…/trace.json too.
    const s = entry.session;
    if (!s || typeof s.getTracer !== 'function') return;
    try {
      const nodeId = typeof s.getRootNodeId === 'function' ? s.getRootNodeId() : undefined;
      s.getTracer().write({
        ts: Date.now(),
        type: 'session_disposed',
        ...(nodeId ? { nodeId } : {}),
        sessionId: entry.sessionId,
        trigger,
        status: entry.status,
      });
    } catch {
      /* best-effort diagnostics — never let tracing break teardown */
    }
  }

  /** Snapshot best-effort, dispose the VM, then drop from the map. `trigger` records WHO
   *  disposed it (default 'explicit'); the reaper passes 'reaper'. */
  async disposeSession(id: string, trigger: 'reaper' | 'evict' | 'explicit' = 'explicit'): Promise<boolean> {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    // Emit the diagnostic BEFORE persistSession so it lands in the persisted trace snapshot.
    this.traceDispose(entry, trigger);
    await this.persistSession(entry);
    try {
      entry.session?.dispose();
    } catch {
      /* best-effort */
    }
    this.sessions.delete(id);
    // Drop the live app-build-target holder (persisted above, if it had moved off the
    // session's own project) so an explicit dispose doesn't leak it — a later resume
    // re-seeds a fresh holder from meta.buildTargetProjectId regardless.
    this.buildTargets.delete(id);
    this.sessionLedger.finalize(id, 'done');
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
    /** A human will read this turn's output even though nobody can answer an
     *  `ask()` — a THING run in a team channel. Turns ON the anti-silent guard so
     *  a turn that works but displays nothing is nudged instead of settling in
     *  silence; deliberately does NOT grant the consent prompter. */
    visibleToUser?: boolean;
    /** Where this headless run came from — recorded as the ledger session `source`
     *  (`hook:<slug>` / `code-node`). Defaults to `headless`. */
    origin?: { source: string };
  }): Promise<HeadlessRunResult> {
    const sessionId = randomUUID();
    let session: Session | undefined;
    const displays: unknown[] = [];
    // S8 instrumentation: headless run lifecycle (hooks/triggers/spawns/delegates
    // all enter here) — guarded fire-and-forget lines, never throw/slow the run.
    const headlessStartedAt = Date.now();
    emitInternalSignal('session.started', { projectId: opts.projectId ?? DEFAULT_PROJECT_ID, agent: opts.agentSlug, ...(opts.spaceRef ? { spaceRef: opts.spaceRef } : {}), sessionId });
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
        // Record this hook/code-node session + its delegates in the ledger.
        this.sessionLedger.trackTracer(session.getTracer(), {
          source: opts.origin?.source ?? 'headless',
          sessionId,
          projectId: opts.projectId ?? DEFAULT_PROJECT_ID,
        });
      }

      await session.start(opts.message);

      // ONLY what the agent displayed. There is deliberately no fallback to the
      // last history entry: in this runtime the model does not answer in prose,
      // it WRITES TYPESCRIPT, so that entry is the turn's source code. Falling
      // back to it meant a turn that displayed nothing "answered" with the
      // agent's own statements — comments, `setActivity(...)` and all — which is
      // what a team channel posted verbatim into the thread.
      //
      // `undefined` is the honest result for "it displayed nothing", and every
      // caller already had to handle that (a failed turn returns no result at
      // all). A caller that wants the reasoning has the tracer.
      const result: unknown = displays.length ? displays[displays.length - 1] : undefined;
      emitInternalSignal('session.completed', { projectId: opts.projectId ?? DEFAULT_PROJECT_ID, agent: opts.agentSlug, ...(opts.spaceRef ? { spaceRef: opts.spaceRef } : {}), sessionId, ok: true, durationMs: Date.now() - headlessStartedAt });
      this.sessionLedger.finalize(sessionId, 'done');
      return { ok: true, result, displays: [...displays], sessionId };
    } catch (err) {
      emitInternalSignal('session.completed', { projectId: opts.projectId ?? DEFAULT_PROJECT_ID, agent: opts.agentSlug, ...(opts.spaceRef ? { spaceRef: opts.spaceRef } : {}), sessionId, ok: false, durationMs: Date.now() - headlessStartedAt });
      this.sessionLedger.finalize(sessionId, 'error');
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
    visibleToUser?: boolean;
    /** Use THIS host instead of a fresh one, so the caller can observe `ask_start`
     *  and resolve it out-of-band (a team channel turns an ask into a thread
     *  message and answers it with the next reply). */
    renderHost?: WebRenderHost;
    /** Per-turn team resolver — merged onto the project's `appGlobals` below.
     *  See {@link runHeadlessThreaded}'s `team`. */
    team?: TeamResolver;
    /** Withhold every write grant for this session — see `BuildSessionArgs.readOnly`. */
    readOnly?: boolean;
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
        renderHost: opts.renderHost ?? new WebRenderHost(),
        ...(opts.visibleToUser ? { visibleToUser: true } : {}),
        ...(opts.readOnly ? { readOnly: true } : {}),
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
    const projectFunctions = await this.getProjectFunctions(projectRoot);

    return {
      spaceDir,
      agentSlug: opts.agentSlug,
      budget: opts.budget,
      traceFile: opts.traceFile,
      renderHost: opts.renderHost ?? new WebRenderHost(),
      ...(opts.visibleToUser ? { visibleToUser: true } : {}),
        ...(opts.readOnly ? { readOnly: true } : {}),
      systemSpaceDirs,
      preloadSpaceDirs,
      projectSpacesDir,
      projectFunctions: projectFunctions.functions,
      projectFunctionsBundled: projectFunctions.functionsBundled,
      projectId,
      projectRoot,
      // The team resolver is the one app global bound to the TURN rather than the
      // project, so it is merged in here instead of inside getProjectAppGlobals
      // (which is cached per project and shared by every caller).
      appGlobals: opts.team ? { ...appGlobals, team: opts.team } : appGlobals,
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
    /** Plain text, or text plus image/file attachments (see {@link
     *  assembleAttachments}) — a team-channel message's attachments travel this
     *  same field the `/chat` session path already uses, not a second one. */
    message: UserInput;
    budget?: BuildSessionArgs['budget'];
    /** A human will read this turn's output even though nobody can answer an
     *  `ask()` — a THING run in a team channel. Turns ON the anti-silent guard so
     *  a turn that works but displays nothing is nudged instead of settling in
     *  silence; deliberately does NOT grant the consent prompter. */
    visibleToUser?: boolean;
    /** Render host to build the session on. Supply one to observe `ask_start` and
     *  answer it yourself; omit for a throwaway host nobody is listening to. */
    renderHost?: WebRenderHost;
    /** Every `setActivity()` of the turn, live. The tracer already writes these;
     *  this is the seam that lets a caller show "currently doing" while it runs. */
    onActivity?: (text: string) => void;
    /** The TEAM surface for this turn (`team:read`/`team:post`), built by the
     *  channel route and closed over the verified caller + channel that started it
     *  (`server/team-globals.ts#createTeamResolver`). PER TURN, not per project:
     *  every other entry in `appGlobals` is bound to the project, this one is bound
     *  to who is asking, which is why it arrives here rather than being assembled in
     *  {@link getProjectAppGlobals}. Omitted ⇒ the agent's team globals reject with
     *  "not running in a team channel" (and on a personal pod they do not exist at
     *  all — the grants are dropped at parse time). */
    team?: TeamResolver;
    /** What started this turn, for the pod's session ledger. A threaded turn has
     *  no client asking for it, so without this every team-channel and every
     *  inbound-webhook turn is absent from `GET /api/session-ledger` — the team
     *  can spend real tokens on work it can never see accounted for. */
    origin?: { source?: string };
    /** The caller may talk to the agent but may not change anything — a team
     *  `viewer`. Withholds every write grant for this turn, so a write is a
     *  typecheck error rather than a rule the agent might not follow. */
    readOnly?: boolean;
  }): Promise<HeadlessRunResult> {
    return this.runExclusive(opts.sessionId, async () => {
      let session: Session | undefined;
      const displays: unknown[] = [];
      // S8 instrumentation: threaded headless turn lifecycle (mirrors runHeadless).
      const threadedStartedAt = Date.now();
      emitInternalSignal('session.started', { projectId: opts.projectId ?? DEFAULT_PROJECT_ID, agent: opts.agentSlug, ...(opts.spaceRef ? { spaceRef: opts.spaceRef } : {}), sessionId: opts.sessionId });
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
          ...(opts.visibleToUser ? { visibleToUser: true } : {}),
        ...(opts.readOnly ? { readOnly: true } : {}),
          ...(opts.renderHost ? { renderHost: opts.renderHost } : {}),
          ...(opts.team ? { team: opts.team } : {}),
          ...(opts.readOnly ? { readOnly: true } : {}),
        });
        session = this.buildSessionFn(args);

        // Capture display descriptors so we can return the agent's final output —
        // same isolated-tracer pattern as runHeadless (no hub is wired).
        if (typeof session.getTracer === 'function') {
          session.getTracer().subscribe((e) => {
            if (e.type === 'display') displays.push(e.descriptor);
            // Live "currently doing", for a caller that has somewhere to show it.
            // A long turn is otherwise a blank wait, which reads as a hang.
            else if (e.type === 'activity' && opts.onActivity) {
              const text = (e as { text?: unknown }).text;
              if (typeof text === 'string' && text.trim()) opts.onActivity(text);
            }
          });
          // Record this turn + its delegates in the pod-global ledger, exactly as
          // `runHeadless` does. Subscribing for displays is NOT the same thing:
          // it feeds this function's return value, while the ledger is what the
          // pod can answer `GET /api/session-ledger` with. Without it a threaded
          // turn — every team-channel message and every inbound webhook — spends
          // real tokens and leaves no record of having done so.
          this.sessionLedger.trackTracer(session.getTracer(), {
            source: opts.origin?.source ?? 'headless-threaded',
            sessionId: opts.sessionId,
            ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
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

        // ONLY what the agent displayed — the same rule as `runHeadless`, and for
        // the same reason: in this runtime the model does not answer in prose, it
        // WRITES TYPESCRIPT, so the last history entry is the turn's source code.
        //
        // The fallback was removed from `runHeadless` precisely because a team
        // channel posted the agent's own statements — comments, `setActivity(...)`,
        // a raw `delegate(...)` call — verbatim into the thread. It survived HERE,
        // and a channel is the one caller that uses this path, so the fix reached
        // every caller except the one it was written for. A live run put
        // "ERROR (attempt 3 of 3)" and a TypeScript overload diagnostic in front of
        // four colleagues.
        //
        // `undefined` is the honest result for "it displayed nothing"; the channel
        // already renders that as a failure rather than as an answer.
        const result: unknown = displays.length ? displays[displays.length - 1] : undefined;

        // A turn that gave up does not throw. `runTurnLoop` returns 'error' when a
        // statement fails its final retry, and until now nothing carried that out
        // of the session — so this path reported ok:true for a turn that had
        // exhausted its retries, and a channel drew it as a finished answer.
        // `ok:false` is what the caller already handles as "say it failed".
        const outcome = typeof session.getLastTurnOutcome === 'function' ? session.getLastTurnOutcome() : null;
        if (outcome === 'error') {
          emitInternalSignal('session.completed', { projectId: opts.projectId ?? DEFAULT_PROJECT_ID, agent: opts.agentSlug, ...(opts.spaceRef ? { spaceRef: opts.spaceRef } : {}), sessionId: opts.sessionId, ok: false, durationMs: Date.now() - threadedStartedAt });
          this.sessionLedger.finalize(opts.sessionId, 'error');
          return {
            ok: false,
            error: 'the turn could not complete — it gave up after its final retry',
            displays: [...displays],
            sessionId: opts.sessionId,
          };
        }
        emitInternalSignal('session.completed', { projectId: opts.projectId ?? DEFAULT_PROJECT_ID, agent: opts.agentSlug, ...(opts.spaceRef ? { spaceRef: opts.spaceRef } : {}), sessionId: opts.sessionId, ok: true, durationMs: Date.now() - threadedStartedAt });
        // Close the ledger record, as `runHeadless` does. Without it every threaded
        // turn stayed `running` forever, so the ledger could show what a channel
        // spent but never that it had finished.
        this.sessionLedger.finalize(opts.sessionId, 'done');
        return { ok: true, result, displays: [...displays], sessionId: opts.sessionId };
      } catch (err) {
        emitInternalSignal('session.completed', { projectId: opts.projectId ?? DEFAULT_PROJECT_ID, agent: opts.agentSlug, ...(opts.spaceRef ? { spaceRef: opts.spaceRef } : {}), sessionId: opts.sessionId, ok: false, durationMs: Date.now() - threadedStartedAt });
        this.sessionLedger.finalize(opts.sessionId, 'error');
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

  /**
   * Run a SPACE tasklist **headless** (plan S9) — the seam a hook handler's
   * `ctx.tasklist.run('<spaceId>/<slug>', seed)` and an agent's out-of-session
   * automation reach. Resolves the installed space
   * (`<root>/<projectId>/spaces/<spaceId>`), builds a real {@link ForkEngine} the
   * way the interactive path does (agent nodes run model forks) plus the
   * {@link createCodeNodeCtxFactory} code-node runner (worker-isolated, provider-
   * locked), runs the DAG via core's {@link runTasklist}, and RECORDS the run as a
   * headless session under the space's sessions dir so its orchestration trace is
   * inspectable in chat. Returns the tasklist's {@link TaskEnvelope} (same value an
   * in-session `tasklist()` yields); a hard failure throws.
   *
   * Project-mode only (requires `lmthingRoot`). The run is NEVER registered in
   * `this.sessions` — like `runHeadless`, it doesn't count against `maxSessions`.
   */
  async runTasklistHeadless(args: {
    projectId: string;
    spaceId: string;
    slug: string;
    seed?: Record<string, unknown>;
    budget?: BuildSessionArgs['budget'];
  }): Promise<TaskEnvelope> {
    const root = this.requireRoot();
    const { projectId, spaceId, slug } = args;
    const projectRoot = join(root, projectId);
    const spaceDir = projectSpaceDir(root, projectId, spaceId);

    const space = await loadSpace(spaceDir, { requireAgents: false });
    if (!space.tasklists[slug]) {
      throw new Error(`tasklist "${slug}" not found in space "${spaceId}" of project "${projectId}"`);
    }

    const sessionId = randomUUID();
    const createdAt = Date.now();
    const renderHost = new WebRenderHost();
    const hub = new TraceHub();
    const tracer = new Tracer(null);
    // Collect the orchestration trace so the run is inspectable as a session.
    const unsubscribe = tracer.subscribe((e) => hub.push(e));

    const parentAgentSlug = Object.keys(space.agents)[0] ?? 'main';
    const appGlobals = this.withConnections(
      await this.getProjectAppGlobals(root, projectId),
      projectRoot,
    );

    // A real ForkEngine so agent nodes run model forks (à la runHeadless). Only
    // the essential parent context is wired; the rest keep their engine defaults.
    const engine = new ForkEngine({
      // Every concurrent fork is another off-heap QuickJS arena, so this is a MEMORY setting as
      // much as a concurrency one. The gateway sizes it against the pod's limit alongside the V8
      // cap and the arena size (`cloud/gateway/src/lib/compute.ts#memoryBudget`); taking the
      // literal 4 here regardless of pod size is what let a 512MiB pod plan for 256MiB of
      // sandboxes it could not afford.
      maxConcurrentForks: maxConcurrentForksFromEnv(),
      parentHistory: [],
      parentSpaceDir: spaceDir,
      parentAgentSlug,
      parentAgentCharter: space.agents[parentAgentSlug]?.charterBody,
      renderHost,
      streamFn: this.streamFn,
      tracer,
      agentFunctions: space.functions,
      agentFunctionsBundled: space.functionsBundled,
      defaultModel: this.defaultModelAlias,
      budgetLimits: args.budget,
      projectRoot,
      projectId,
      projectSpacesDir: join(projectRoot, 'spaces'),
      appGlobals,
      dynamicSpaces: new Map(),
      documentResolver: (id, opts) => this.resolveDocument(id, opts),
      // A task node that opts into delegation runs a headless agent.
      delegateRunner: (packageName, agentName, action, delegateOpts) =>
        this.codeNodeDelegate(projectId, `${packageName}/${agentName}`, action, delegateOpts),
    });

    const codeNodeCtxFactory = this.buildCodeNodeCtxFactory(root, projectId, projectRoot);

    const rootScope = tracer.root(sessionId);
    let envelope: TaskEnvelope | undefined;
    let error: unknown;
    try {
      envelope = await runTasklist({
        name: slug,
        space,
        forkEngine: engine,
        seed: args.seed,
        tracer,
        parentScope: rootScope,
        codeNodeCtxFactory,
      });
    } catch (err) {
      error = err;
    } finally {
      unsubscribe();
    }

    // Record the run as a headless session (empty chat history — the value is the
    // orchestration trace tree). Best-effort: a persistence failure never masks the
    // tasklist result/throw.
    try {
      const dir = join(spaceSessionsDir(root, projectId, spaceId), sessionId);
      await mkdir(dir, { recursive: true });
      await saveSnapshot(dir, {
        sessionId,
        agentSlug: parentAgentSlug,
        spaceDir,
        history: [],
        scope: {},
        createdAt,
      });
      const meta: PersistedSessionMeta = {
        sessionId,
        projectId,
        agentSlug: parentAgentSlug,
        spaceDir,
        spaceId,
        title: `Tasklist ${spaceId}/${slug}`,
        createdAt,
        lastActivity: Date.now(),
        messageCount: 0,
        status: error ? 'error' : 'idle',
      };
      await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
      await writeFile(join(dir, 'trace.json'), JSON.stringify(hub.snapshot().events), 'utf8');
    } catch (persistErr) {
      console.warn(
        `[tasklist-runner] failed to record run ${sessionId}: ` +
          (persistErr instanceof Error ? persistErr.message : String(persistErr)),
      );
    }

    if (error) throw error instanceof Error ? error : new Error(String(error));
    return envelope as TaskEnvelope;
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
    // Sync core shared with the agent-facing `createProject` global, so a project
    // is created identically whether the REST route or an agent triggers it.
    const meta = createProjectSync(root, name);
    // S8 instrumentation: server-side project creation (guarded one-liner).
    // `fanOutAll`: the new project's id is the signal's SUBJECT, not its audience —
    // a just-scaffolded project has no emitter defs or hooks, so the default
    // projectId-scoped fan-out would deliver it to the one project that cannot
    // possibly subscribe. Every project holding an `integration-lmthing` def wants it.
    emitInternalSignal('project.created', { projectId: meta.id }, { fanOutAll: true });
    return meta;
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
    // S8 instrumentation: the project-DOCUMENT write choke point (the documents
    // route + any internal caller land here). Generic fs writes (PUT
    // /api/fs/write) are NOT classified as project documents — see S8 notes.
    emitInternalSignal('document.written', { projectId: safeId, path: `documents/${safeName}` });
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
    this.reaper = setInterval(() => this.reapIdleOnce(), intervalMs);
    // Don't keep the process alive solely for the reaper.
    this.reaper.unref?.();
  }

  /**
   * One reaper sweep: dispose sessions idle past {@link idleTtlMs}. NEVER reaps a session
   * whose turn is in flight (`status === 'running'`) — the SAME guard {@link evictOneIdle}
   * enforces. `lastActivity` is only touched at turn start/end (see {@link sendMessage}),
   * so a long build/turn that outlasts the idle TTL would otherwise be reaped mid-work — the
   * "session vanished mid-turn" failure. A genuinely idle session (running just ended, or it
   * was idle between turns) reaps as before. Extracted from the interval body so it is
   * deterministically unit-testable (pass an explicit `now`).
   */
  reapIdleOnce(now = Date.now()): void {
    for (const [id, entry] of this.sessions) {
      if (entry.status === 'running') continue; // never reap an in-flight turn
      if (now - entry.lastActivity > this.idleTtlMs) {
        // disposeSession → traceDispose logs the kill (trigger=reaper) to both sinks.
        void this.disposeSession(id, 'reaper');
      }
    }
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

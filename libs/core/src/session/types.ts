import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { BudgetLimits } from '../eval/budget.js';
import type { RoleModelConfig } from '../fork/roles.js';
import type { AppGlobalImpls } from '../exec/app-globals.js';
import type { DocumentResolver } from '../globals/read-document.js';
import type { IntegrationStatusResolver } from '../globals/integration-status.js';
import type { ConsentPrompter } from '../globals/consent.js';
import type { CodeNodeCtxFactory } from '../tasklist/orchestrator.js';
import type { DbTableSchema } from '../typecheck/library-dts.js';

export interface RenderHost {
  display(descriptor: unknown): void;
  ask(id: string, descriptor: unknown): Promise<unknown>;
  log(message: string): void;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): void;
  clearTimeout(id: unknown): void;
}

/** The live project a delegate should build INTO when THING has set an app-BUILD
 *  TARGET (createProject/selectProject) distinct from THING's own session project.
 *  Carries the target project's own roots + its per-project appGlobals so the
 *  delegated builder's `db` + `writeProject*` writers bind to the NEW live project
 *  (`.lmthing/<projectId>`), not THING's `user` project. Returned by
 *  {@link SessionOpts.resolveBuildTarget}; null there means "no target — build into
 *  this session's own project" (the normal path). */
export interface DelegateProjectContext {
  projectId: string;
  projectRoot: string;
  projectSpacesDir?: string;
  appGlobals?: AppGlobalImpls;
}

export interface SessionOpts {
  spaceDir: string;
  agentSlug: string;
  modelAlias: string;
  renderHost: RenderHost;
  maxRetries?: number;
  maxConcurrentForks?: number;
  /** Inactivity watchdog for the model stream (ms). A turn whose stream emits no token
   *  for this long is retried as a transient failure. Default 60000. */
  streamIdleMs?: number;
  clock?: Clock;
  traceFile?: string;
  /** Override the always-loaded system space directories. Defaults to the
   *  bundled fs/web/memory/todo/agents spaces. Pass [] to disable. */
  systemSpaceDirs?: string[];
  /** When set, collapse history to a summary once it exceeds maxHistoryTurns*2
   *  messages (keeping the last few verbatim). Used by long REPL sessions. */
  maxHistoryTurns?: number;
  /** Mid-turn history-compaction threshold in CHARACTERS. DEFAULT-ON (~400k chars ≈
   *  ~100k tokens): the turn loop calls `Session.maybeCompactHistoryBySize()` at the top of
   *  EVERY cycle, and once total history chars cross this, old turns collapse to a digest
   *  (keeping the recent messages verbatim). Independent of `maxHistoryTurns` — a long SINGLE
   *  turn (many yield-resume cycles) never crosses a turn boundary, so `maxHistoryTurns` alone
   *  let its history grow until it overflowed V8's max string length (the runaway-turn crash).
   *  Set to 0 to disable. */
  maxPromptChars?: number;
  /** When true, bypass an agent's `defaultAction` routing so the first turn runs
   *  the model-driven turn loop instead of the action's tasklist. */
  noDefaultAction?: boolean;
  /** Host-enforced budget caps (episodes / tool calls / fork depth / wall clock).
   *  Reset per start()/continue() invocation. Cannot be disabled from inside the VM. */
  budget?: BudgetLimits;
  /** Optional per-role model assignment for forks (e.g. explore/plan → cheap model). */
  roleModels?: RoleModelConfig;
  /** Absolute space dirs to load into dynamicSpaces at session.start(), making them
   *  delegatable immediately (e.g. existing project spaces). Each dir is loaded via
   *  loadSpace and keyed by its dir path. Failures are logged but do not block startup. */
  preloadSpaceDirs?: string[];
  /** Absolute path to the project's spaces/ dir. Exposed to ALL VMs (session, forks,
   *  delegates) as process.env.LMTHING_PROJECT_SPACES_DIR so the architect can write
   *  synthesized spaces there instead of stripping LMTHING_SPACE_DIR. */
  projectSpacesDir?: string;
  /** Absolute project root `<root>/<projectId>` — the app layer (database/pages/api/hooks)
   *  root, distinct from spaceDir (per-agent) and projectSpacesDir (the spaces/ dir).
   *  Threaded into every child VM (session/fork/delegate) and exposed as
   *  LMTHING_PROJECT_DIR; gates app-capability global injection. A top-level THING
   *  session with no projectRoot gets no app globals. */
  projectRoot?: string;
  /** The project id (basename of projectRoot); exposed as LMTHING_PROJECT_ID. */
  projectId?: string;
  /** The PROJECT's functions (`<projectRoot>/functions/*.ts`) — the THIRD function
   *  scope, loaded by libs/cli (loadProjectFunctions) and injected into project-rooted
   *  sessions (and their forks, via the shared agentFunctions map) alongside the
   *  system + space functions. Original TS source keyed by name; `projectFunctionsBundled`
   *  carries esbuild output when the project shipped node_modules. Absent for
   *  legacy/non-project sessions — that scoping is what keeps them project-only. A name
   *  already provided by the system toolkit or the agent's selected space functions WINS
   *  (the colliding project function is dropped + a shadow warning is logged), so the
   *  DTS overlay never double-declares. */
  projectFunctions?: Record<string, string>;
  projectFunctionsBundled?: Record<string, string>;
  /** Project-generated typed `apiCall` overloads (Phase 4) — appended to the agent's ambient
   *  DTS when it holds `api:call`, so `apiCall('markRead', …)` is strictly typed. Built by
   *  libs/cli from the project's `api/` endpoint contracts. */
  appDts?: string;
  /** The real per-run DB schema (table names + column names) used to GATE `db.*` at
   *  typecheck: a hallucinated table or a typo'd column fails typecheck (retryable) instead
   *  of returning an empty result the model fabricates against. Derived cheaply by libs/cli
   *  from `database/*.json` (basenames + column keys, NOT ts-json-schema-generator). Absent
   *  for a non-project session ⇒ the loose `string`-typed db members (unchanged behavior).
   *  Threaded into every child VM (session/fork/delegate) via `buildAmbientDts`. */
  dbSchema?: DbTableSchema[];
  /** Freshness (TARGETED invalidation). A monotonically-bumped revision for THIS project's
   *  schema — the session reads it each turn (cheap Map counter) and, only when it changed
   *  since the last bake (a `createTable`/`writeProjectTable` landed), re-derives via
   *  `resolveDbSchema` and re-bakes the ambient DTS. Absent ⇒ the schema is treated as fixed
   *  for the session's life (no re-bake). */
  dbSchemaRevision?: () => number;
  /** Re-derive the current `dbSchema` — called by the session ONLY on a turn where
   *  `dbSchemaRevision()` changed, so a table created in one turn is queryable (typechecks)
   *  in the next. Cheap + synchronous (reads a host-cached map, not the filesystem). */
  resolveDbSchema?: () => DbTableSchema[] | undefined;
  /** Host-provided app-global engine impls (the project's db store, etc.). Wrapped in the
   *  capability-scope check and injected into the session VM + its forks/delegates when the
   *  agent holds the matching grants AND projectRoot is set (see exec/app-globals.ts). The
   *  db impl is built by libs/cli (better-sqlite3) per project. */
  appGlobals?: AppGlobalImpls;
  /** Host hook (project:manage) — the current app-BUILD TARGET for delegates.
   *  THING's `createProject`/`selectProject` globals set a session-scoped target project
   *  (a live project under `.lmthing/<id>`). When that target differs from THIS session's
   *  own project, a delegate (the automator) must build into the TARGET, not THING's own
   *  project — THING never builds into `user`. The host resolves the target's
   *  projectId/projectRoot/projectSpacesDir + that project's own `appGlobals`
   *  (getProjectAppGlobals) so the delegated builder's `db` + `writeProject*` writers bind
   *  to the new live project. Returns null when no target is set (delegate builds into this
   *  session's own project — the normal path for an already-real project). */
  resolveBuildTarget?: () => Promise<DelegateProjectContext | null>;
  /** Host resolver for the universal `readDocument` global — extracts a stored
   *  upload's text (unpdf/utf8/transcript) Node-side. Supplied by libs/cli (where
   *  the uploads dir is known) and threaded into the session, its delegates and
   *  forks. Project-independent (NOT an app-global): absent ⇒ a readDocument yield
   *  rejects with a clear "no document resolver configured" error. */
  documentResolver?: DocumentResolver;
  /** Host resolver for the `integrationStatus` global — reports presence-only config
   *  status (names of missing required env vars, never their values) for an installed
   *  integration space in this project. Supplied by libs/cli (knows the project root +
   *  `process.env`); threaded into the project-rooted session. Absent ⇒ an
   *  `integrationStatus` yield rejects with a clear "no project scope" error. */
  integrationStatusResolver?: IntegrationStatusResolver;
  /** Consent prompter for consent-marked invocations (plan S10) — built on the
   *  `renderHost.ask` plumbing (see `createAskConsentPrompter`) and supplied ONLY
   *  for INTERACTIVE sessions: headless runs/forks/delegates/hooks leave it unset
   *  so a consent-marked call FAILS CLOSED ("requires user consent — run
   *  interactively") instead of hanging on an ask nobody will answer. Threaded
   *  into the yield router as `requestConsent`. */
  consentPrompter?: ConsentPrompter;
  /** Host-built factory for `kind:'code'` tasklist nodes (plan S9). Threaded into
   *  the session's yield-router context so a `tasklist()` yield whose SPACE tasklist
   *  contains code nodes can run them: for each node the CLI/pod loads its
   *  `run(ctx, inputs)` module in a Node worker with a ctx (db + delegate +
   *  callConnection locked to the space/tasklist `connections:`) serviced
   *  main-side. Absent for legacy/non-project sessions (and bare unit tests) — a
   *  code node then fails with a clear required-task error (core never executes
   *  the node module itself). Built by libs/cli's `createCodeNodeCtxFactory`. */
  codeNodeCtxFactory?: CodeNodeCtxFactory;
}

export interface SessionDeps {
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
}

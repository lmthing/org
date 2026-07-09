import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { BudgetLimits } from '../eval/budget.js';
import type { RoleModelConfig } from '../fork/roles.js';
import type { AppGlobalImpls } from '../exec/app-globals.js';
import type { DocumentResolver } from '../globals/read-document.js';

export interface RenderHost {
  display(descriptor: unknown): void;
  ask(id: string, descriptor: unknown): Promise<unknown>;
  log(message: string): void;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): void;
  clearTimeout(id: unknown): void;
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
  /** Project-generated typed `apiCall` overloads (Phase 4) — appended to the agent's ambient
   *  DTS when it holds `api:call`, so `apiCall('markRead', …)` is strictly typed. Built by
   *  libs/cli from the project's `api/` endpoint contracts. */
  appDts?: string;
  /** Host-provided app-global engine impls (the project's db store, etc.). Wrapped in the
   *  capability-scope check and injected into the session VM + its forks/delegates when the
   *  agent holds the matching grants AND projectRoot is set (see exec/app-globals.ts). The
   *  db impl is built by libs/cli (better-sqlite3) per project. */
  appGlobals?: AppGlobalImpls;
  /** Host resolver for the universal `readDocument` global — extracts a stored
   *  upload's text (unpdf/utf8/transcript) Node-side. Supplied by libs/cli (where
   *  the uploads dir is known) and threaded into the session, its delegates and
   *  forks. Project-independent (NOT an app-global): absent ⇒ a readDocument yield
   *  rejects with a clear "no document resolver configured" error. */
  documentResolver?: DocumentResolver;
}

export interface SessionDeps {
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
}

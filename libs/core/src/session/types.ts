import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { BudgetLimits } from '../eval/budget.js';
import type { RoleModelConfig } from '../fork/roles.js';

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
}

export interface SessionDeps {
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
}

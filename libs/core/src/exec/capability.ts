import { roleProfile } from '../fork/roles.js';
import type { AppCapabilities } from '../spaces/capabilities.js';

/**
 * Read-only fork roles (`explore`/`plan`) can never receive a write/authoring
 * capability — the app grants are intersected with `allowWrite`, exactly as the
 * host-tools write gate withholds `writeFileRaw`. Only the read/outbound grants
 * (`db:read`, `api:call`, `connections:use`, `store:read`) survive; every
 * mutating/authoring grant (`db:write`/`db:schema`/`pages:write`/`api:write`/
 * `hooks:write`/`store:install`/`events:emit`) is dropped. NOTE: `connections:use`
 * can have a side-effect (POST to an external service), but is treated as
 * outbound like `api:call` — the caller's own read-only intent governs, not the
 * transport. Drop it here if read-only forks must never mutate external state.
 */
export function intersectAppCaps(app: AppCapabilities, allowWrite: boolean): AppCapabilities {
  if (allowWrite) return app;
  const out: AppCapabilities = {};
  if (app['db:read']) out['db:read'] = app['db:read'];
  if (app['api:call']) out['api:call'] = app['api:call'];
  if (app['connections:use']) out['connections:use'] = app['connections:use'];
  // store:read is pure catalog discovery — safe for read-only roles. The
  // mutating store:install (writes into the project) and events:emit (triggers
  // hooks) are withheld, like every other write grant.
  if (app['store:read']) out['store:read'] = app['store:read'];
  return out;
}

/**
 * CapabilityProfile — the single description of what a child VM context may do.
 *
 * The three execution contexts (top-level session, fork leaf, delegate) used to
 * hand-maintain three near-identical wiring blocks that silently drifted apart
 * (the A1 delegate-nesting bug). The profile now drives BOTH sides of the wiring
 * from one value:
 *   - which value-yielding globals `createChildVM` injects (exec/bootstrap.ts)
 *   - which ambient declarations `buildAmbientDts` emits, so a call to a global
 *     that is not injected fails typecheck (a clean retryable error) instead of
 *     passing typecheck and throwing at runtime.
 *
 * Phase 5: the `delegate` flag is now driven at EVERY level by the unified
 * `canDelegateTo` policy (`exec/target-match.ts evaluateDelegatePolicy`) —
 * callers pass `policy.mode !== 'none'` so injection and the ambient DTS stay
 * in lockstep with the yield-time gate.
 */
export interface CapabilityProfile {
  /** Which context this VM runs: informational + future gating. */
  kind: 'session' | 'fork' | 'delegate';
  /** `ask()` — top-level session only (forks/delegates are headless/autonomous). */
  ask: boolean;
  /** `fork()` + `tasklist()` — orchestrating contexts only, never fork leaves
   *  (a leaf spawning its own subtree would bypass the concurrency semaphore
   *  and the depth accounting). */
  orchestrate: boolean;
  /** `delegate()` global. Gated at every level by the unified `canDelegateTo`
   *  policy: sessions/delegates lose it when their AGENT declares
   *  `canDelegateTo: []`; fork leaves only get it when the TASK opts in via
   *  `canDelegateTo` AND the engine has a delegateRunner wired. */
  delegate: boolean;
  /** `registerSpace()` — a session-state mutation (writes the shared
   *  dynamicSpaces map), so it is withheld from read-only fork roles exactly
   *  like writeFileRaw. NOTE: its DTS declaration is unconditional (matching
   *  the pre-unification DTS, which only stripped ask/tasklist/fork/delegate). */
  registerSpace: boolean;
  /** `setSessionMeta()` — sets the session title/slug. Top-level session only
   *  (forks/delegates are headless sub-runs with no session identity to name),
   *  so it is gated exactly like `ask`. */
  setSessionMeta: boolean;
  /** Host write access: writeFileRaw + mutating shell commands (host-tools profile). */
  allowWrite: boolean;
  /** `createScratch()` + a sandboxed generic fs/shell surface (the engineer's code
   *  sandbox). Derived from the `fs:scratch` app grant. When true, `createChildVM`
   *  injects the scratch primitives and overrides `execShell` with the scratch-rooted
   *  one, and `buildAmbientDts` emits `SCRATCH_DTS` + `EXEC_SHELL_DTS`. When false —
   *  every non-engineer agent — the generic fs surface is neither injected as a
   *  callable model global nor declared, so a stray call fails typecheck. */
  scratchFs: boolean;
  /** Project-app capability grants (`capabilities:` frontmatter → parsed `AppCapabilities`).
   *  Drives BOTH which app globals `createChildVM` injects (`db.*`/`apiCall`/`writePage`/…)
   *  AND which capability fragments `buildAmbientDts` emits — kept in lockstep exactly like
   *  the boolean flags above. Empty (`{}`) for any agent that declares no `capabilities:`
   *  (the default), so a session/fork/delegate with no app grants injects no app globals and
   *  declares none in its DTS. Read-only fork roles receive the `allowWrite`-intersected set. */
  app: AppCapabilities;
}

/** Top-level session VM: the full toolkit, including the interactive `ask()`.
 *  `canDelegate` comes from the session agent's `canDelegateTo` policy
 *  (`evaluateDelegatePolicy(...).mode !== 'none'`); defaults to true. */
export function sessionCapabilities(canDelegate = true, app: AppCapabilities = {}): CapabilityProfile {
  return { kind: 'session', ask: true, orchestrate: true, delegate: canDelegate, registerSpace: true, setSessionMeta: true, allowWrite: true, scratchFs: !!app['fs:scratch'], app };
}

/**
 * Fork leaf VM. Headless (no ask), non-orchestrating (no fork/tasklist);
 * `delegate` only when the task's `canDelegateTo` gate is satisfied by the
 * caller; write capability (and registerSpace, which mutates session state)
 * follows the role's host-tools profile — explore/plan are read-only.
 */
export function forkCapabilities(role: string | undefined, canDelegate: boolean, app: AppCapabilities = {}): CapabilityProfile {
  const allowWrite = roleProfile(role).allowWrite !== false;
  const forkApp = intersectAppCaps(app, allowWrite);
  return { kind: 'fork', ask: false, orchestrate: false, delegate: canDelegate, registerSpace: allowWrite, setSessionMeta: false, allowWrite, scratchFs: !!forkApp['fs:scratch'], app: forkApp };
}

/**
 * Delegate VM. A programmatic sub-agent: autonomous (no ask), but a full
 * orchestrator over its own actions/tasklists (fork/tasklist). `delegate`
 * follows the DELEGATED AGENT's own `canDelegateTo` policy (defaults to true).
 * registerSpace is not injected (matching the pre-unification wiring — spaces
 * are registered by the session or by write-capable forks).
 */
export function delegateCapabilities(canDelegate = true, app: AppCapabilities = {}): CapabilityProfile {
  return { kind: 'delegate', ask: false, orchestrate: true, delegate: canDelegate, registerSpace: false, setSessionMeta: false, allowWrite: true, scratchFs: !!app['fs:scratch'], app };
}

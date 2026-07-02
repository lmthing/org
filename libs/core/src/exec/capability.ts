import { roleProfile } from '../fork/roles.js';

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
}

/** Top-level session VM: the full toolkit, including the interactive `ask()`.
 *  `canDelegate` comes from the session agent's `canDelegateTo` policy
 *  (`evaluateDelegatePolicy(...).mode !== 'none'`); defaults to true. */
export function sessionCapabilities(canDelegate = true): CapabilityProfile {
  return { kind: 'session', ask: true, orchestrate: true, delegate: canDelegate, registerSpace: true, setSessionMeta: true, allowWrite: true };
}

/**
 * Fork leaf VM. Headless (no ask), non-orchestrating (no fork/tasklist);
 * `delegate` only when the task's `canDelegateTo` gate is satisfied by the
 * caller; write capability (and registerSpace, which mutates session state)
 * follows the role's host-tools profile — explore/plan are read-only.
 */
export function forkCapabilities(role: string | undefined, canDelegate: boolean): CapabilityProfile {
  const allowWrite = roleProfile(role).allowWrite !== false;
  return { kind: 'fork', ask: false, orchestrate: false, delegate: canDelegate, registerSpace: allowWrite, setSessionMeta: false, allowWrite };
}

/**
 * Delegate VM. A programmatic sub-agent: autonomous (no ask), but a full
 * orchestrator over its own actions/tasklists (fork/tasklist). `delegate`
 * follows the DELEGATED AGENT's own `canDelegateTo` policy (defaults to true).
 * registerSpace is not injected (matching the pre-unification wiring — spaces
 * are registered by the session or by write-capable forks).
 */
export function delegateCapabilities(canDelegate = true): CapabilityProfile {
  return { kind: 'delegate', ask: false, orchestrate: true, delegate: canDelegate, registerSpace: false, setSessionMeta: false, allowWrite: true };
}

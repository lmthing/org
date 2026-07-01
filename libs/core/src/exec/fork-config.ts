import type { ForkEngineOpts } from '../fork/fork.js';

/**
 * ForkEngineParentContext — a ForkEngine constructor-options bag in which EVERY
 * field of `ForkEngineOpts` must be spelled out, including the optional ones
 * (as an explicit `undefined` with a comment saying why the site has no value).
 *
 * This is the structural fix for the A1 drift class: `session/session.ts` and
 * `delegate/delegate.ts` each construct a ForkEngine, and the delegate site
 * silently omitted `budgetLimits` / `roleModels` / `forkDepth` / `dynamicSpaces`
 * — so leaf forks nested under a delegate ran uncapped (never got the
 * near-limit "resolve NOW" nudge), on the wrong per-role model, with
 * meaningless depth accounting and a dead registerSpace propagation path.
 * With this mapped type, adding a field to `ForkEngineOpts` is a compile error
 * at every wiring site until that site takes an explicit position on it.
 */
export type ForkEngineParentContext = { [K in keyof Required<ForkEngineOpts>]: ForkEngineOpts[K] };

/**
 * Build the full ForkEngine constructor options from one exhaustively-typed
 * parent-context bag. Both wiring sites (session `getForkEngine()`, delegate
 * `runDelegate()`) MUST go through this — never construct `ForkEngineOpts`
 * literals directly — so the option lists can never drift apart again.
 */
export function forkEngineOptsFrom(parent: ForkEngineParentContext): ForkEngineOpts {
  return { ...parent };
}

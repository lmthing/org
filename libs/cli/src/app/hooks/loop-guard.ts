/**
 * Hook **loop guard** (Phase 6, 6A) — the PURE decision + matching layer.
 *
 * These functions carry no I/O, no clock, and no state of their own — the clock
 * (`now`), the cooldown window, the last-fired map, and the cascade depth are all
 * *injected* — so the whole firing policy is exhaustively unit-testable.
 *
 * Since S6 the queue drains the unified EVENT pipeline (db-emitter events +
 * synthetic raw-table events + any emitted event), not just db writes, so the
 * queue's payload is the {@link DispatchEvent} superset and the matcher is
 * {@link matchEventHooks} (source-qualified `on.event` address). The three
 * firing guards are unchanged and cover EVERY event kind:
 *   1. **Depth cap** — an event already `HOOK_DEPTH_CAP` levels deep in a hook
 *      cascade stops firing further hooks (bounds runaway cascades).
 *   2. **Self-write exclusion** — a hook never fires on an event produced by its
 *      OWN triggered session (`originatingHookSlug === hook.slug`), so a hook that
 *      writes the very table it subscribes to does not re-trigger itself.
 *   3. **Cooldown / coalesce** — a hook fires at most once per `cooldownMs`; a
 *      burst of same-address events inside that window collapses to a single fire.
 */

import type { LoadedHook, EventHookDef } from './loader.js';

/** The three project-db write kinds (matches core's `DbEmitterEvent`) — used to
 *  name a synthetic `project/db.<table>.<event>` address in the app runtime. */
export type { WriteEventKind } from './loader.js';

/**
 * A dispatchable event offered to the {@link HookDispatcher} queue — the
 * superset of a raw db write and any emitted event. Replaces the S6-predecessor
 * `WriteEvent` (table+event only): an event now carries its source-qualified
 * `address` (`<scope>/<name>`) and a serializable `payload`, so ONE queue drains
 * db-emitter events, synthetic raw-table events, and any emitted event under the
 * same coalesce/cooldown/depth guards.
 */
export interface DispatchEvent {
  /** Source-qualified event address subscribing event hooks match on
   *  (`project/db.raw_items.insert`, `integration-slack/message.posted`). */
  address: string;
  /** The event payload — handed to a subscribing handler hook as `ctx.input`,
   *  serialized into a trigger hook's kickoff seed. */
  payload: Record<string, unknown>;
  /** How deep this event already sits in a hook cascade (0 = a user/api write). */
  hookDepth: number;
  /** The slug of the hook whose triggered run produced this event, if any. */
  originatingHookSlug?: string;
  /** Optional external thread key → a stable multi-turn session for triggers. */
  threadKey?: string;
}

/** Depth at/after which cascaded events stop firing hooks. */
export const HOOK_DEPTH_CAP = 3;

/**
 * The injected context a {@link shouldFireHook} decision reads. `hookDepth` /
 * `originatingHookSlug` mirror the triggering {@link DispatchEvent}; they are on
 * the ctx (not read off the event) so each guard can be exercised in isolation.
 */
export interface ShouldFireCtx {
  /** Cascade depth of the triggering event. */
  hookDepth: number;
  /** The hook whose session produced the triggering event, if any. */
  originatingHookSlug?: string;
  /** Last-fired epoch-ms per hook slug (cooldown source). */
  lastFiredAt: Record<string, number>;
  /** Injected clock. */
  now: number;
  /** The per-hook cooldown window. */
  cooldownMs: number;
}

/** The outcome of a firing decision. */
export interface FireDecision {
  fire: boolean;
  /** Present when `fire` is false: `depth-cap` | `self-write` | `cooldown`. */
  reason?: 'depth-cap' | 'self-write' | 'cooldown';
}

/**
 * Decide whether `hook` should fire, per the injected `ctx`. Pure. The depth +
 * originating-hook signals come from `ctx` (which the dispatcher seeds from the
 * event), so the three guards can be exercised in isolation.
 */
export function shouldFireHook(hook: LoadedHook, ctx: ShouldFireCtx): FireDecision {
  // 1. Depth cap — an event already at/beyond the cap fires no more hooks.
  if (ctx.hookDepth >= HOOK_DEPTH_CAP) return { fire: false, reason: 'depth-cap' };

  // 2. Self-write exclusion — the hook's own triggered event never re-fires it.
  if (ctx.originatingHookSlug !== undefined && ctx.originatingHookSlug === hook.slug) {
    return { fire: false, reason: 'self-write' };
  }

  // 3. Cooldown / coalesce — at most one fire per window.
  const last = ctx.lastFiredAt[hook.slug];
  if (last !== undefined && ctx.now - last < ctx.cooldownMs) {
    return { fire: false, reason: 'cooldown' };
  }

  return { fire: true };
}

/**
 * The subscribing event hooks for a source-qualified `address` — every loaded
 * `event`-type hook whose `on.event` equals it. Pure (no i/o) so it's directly
 * unit-testable against a fixed hook list. This is the SINGLE event matcher —
 * `server/event-dispatch.ts` re-exports it, so db-coalesced dispatch and direct
 * (webhook/cron/internal) dispatch share one matching rule.
 */
export function matchEventHooks(hooks: LoadedHook[], address: string): LoadedHook[] {
  return hooks.filter((h) => h.def.type === 'event' && (h.def as EventHookDef).on.event === address);
}

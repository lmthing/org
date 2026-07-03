/**
 * Hook **loop guard** (Phase 6, 6A) — the PURE decision layer.
 *
 * These functions carry no I/O, no clock, and no state of their own — the clock
 * (`now`), the cooldown window, the last-fired map, and the cascade depth are all
 * *injected* — so the whole firing policy is exhaustively unit-testable.
 *
 * The policy has three guards (parent plan §Safety):
 *   1. **Depth cap** — a write already `HOOK_DEPTH_CAP` levels deep in a hook
 *      cascade stops firing further hooks (bounds runaway cascades).
 *   2. **Self-write exclusion** — a database hook never fires on a write made by
 *      its OWN triggered session (`event.originatingHookSlug === hook.slug`), so a
 *      hook that writes the very table it watches does not re-trigger itself.
 *   3. **Cooldown / coalesce** — a hook fires at most once per `cooldownMs`; a
 *      burst of same-table writes inside that window collapses to a single fire.
 */

import type { LoadedHook, WriteEventKind } from './loader.js';

/** A committed database write, offered to the dispatcher post-commit. */
export interface WriteEvent {
  table: string;
  event: WriteEventKind;
  /** The written rows (each becomes a `row` for an imperative handler). */
  rows: unknown[];
  /** How deep this write already sits in a hook cascade (0 = user/api write). */
  hookDepth: number;
  /** The slug of the hook whose session made this write, if any. */
  originatingHookSlug?: string;
}

/** Depth at/after which cascaded writes stop firing hooks. */
export const HOOK_DEPTH_CAP = 3;

/**
 * The injected context a {@link shouldFireHook} decision reads. `hookDepth` /
 * `originatingHookSlug` mirror the triggering {@link WriteEvent}; they are also
 * on the ctx so a caller may override them independently of the event.
 */
export interface ShouldFireCtx {
  /** Cascade depth of the triggering write (defaults to `event.hookDepth`). */
  hookDepth: number;
  /** The hook whose session made the triggering write, if any. */
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
 * Decide whether `hook` should fire for `event`, per the injected `ctx`. Pure.
 * The depth + originating-hook signals come from `ctx` (which the dispatcher
 * seeds from the event), so the three guards can be exercised in isolation.
 */
export function shouldFireHook(hook: LoadedHook, event: WriteEvent, ctx: ShouldFireCtx): FireDecision {
  void event; // event identity is matched upstream; the guards read ctx

  // 1. Depth cap — a write already at/beyond the cap fires no more hooks.
  if (ctx.hookDepth >= HOOK_DEPTH_CAP) return { fire: false, reason: 'depth-cap' };

  // 2. Self-write exclusion — the hook's own triggered write never re-fires it.
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
 * The database hooks whose `on.table`/`on.event` match `event`. Pure.
 */
export function matchDatabaseHooks(hooks: LoadedHook[], event: WriteEvent): LoadedHook[] {
  return hooks.filter(
    (h) =>
      h.def.type === 'database' &&
      h.def.on.table === event.table &&
      h.def.on.event === event.event,
  );
}

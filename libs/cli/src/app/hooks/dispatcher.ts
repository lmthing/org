/**
 * Hook **dispatch queue** (Phase 6, 6A) — the decoupled post-commit queue.
 *
 * The write path is **in-process and decoupled**: after a database write commits,
 * the integrator calls {@link HookDispatcher.enqueue} with a {@link WriteEvent}.
 * `enqueue` synchronously computes which hooks match + should fire and pushes one
 * queue entry each, then **returns immediately** — it never runs a hook. The
 * queue drains on the next event-loop tick, AFTER the current eval unwinds, when
 * the integrator calls {@link HookDispatcher.drain}. This is what keeps hook
 * dispatch non-re-entrant: a write made *by* a running hook enqueues into the
 * NEXT drain cycle, not the one in flight.
 *
 * Two coalescing rules keep the loop bounded (parent plan §Safety):
 *   - **Queue coalesce** — at most one queued entry per hook slug; a later write
 *     replaces the earlier entry with the latest event (one drain → one fire).
 *   - **Budget-exhaustion queue** — when `run` reports a hook ran out of budget,
 *     ≤1 pending entry per slug is kept and retried on the next drain (once the
 *     budget window rolls).
 *
 * The firing *decision* lives in {@link loop-guard} (pure); this class owns the
 * queue mechanics + the injected clock and last-fired map (cooldown state).
 */

import {
  matchDatabaseHooks,
  shouldFireHook,
  type ShouldFireCtx,
  type WriteEvent,
} from './loop-guard.js';
import type { LoadedHook } from './loader.js';

/** One queued hook firing. */
export interface QueueEntry {
  /** The hook to run. */
  slug: string;
  /** The write that triggered it (the latest, after coalescing). */
  event: WriteEvent;
  /** The cascade depth a write made by THIS firing will carry (`event+1`). */
  hookDepth: number;
  /** When this entry was (last) enqueued (injected clock). */
  enqueuedAt: number;
}

/** What a `run` callback signals back to the dispatcher. */
export interface RunOutcome {
  /** The hook's session hit its budget; keep it pending for a later retry. */
  budgetExhausted?: boolean;
}

/** A run callback — the integrator wires this to runHeadless/delegate. */
export type RunFn = (entry: QueueEntry) => Promise<RunOutcome | void>;

/** Constructor options for {@link HookDispatcher}. */
export interface HookDispatcherOpts {
  /** The project's loaded hooks (database hooks are the ones dispatched). */
  hooks: LoadedHook[];
  /** The per-hook cooldown / coalesce window (ms). */
  cooldownMs: number;
  /** Injected clock; defaults to `Date.now`. */
  now?: () => number;
  /** Seed last-fired state (e.g. rehydrated from `hooks-state.json`). */
  lastFiredAt?: Record<string, number>;
}

export class HookDispatcher {
  private readonly hooks: LoadedHook[];
  private readonly cooldownMs: number;
  private readonly now: () => number;
  /** Last-fired epoch-ms per slug (cooldown source; updated on drain). */
  readonly lastFiredAt: Record<string, number>;

  /** The live queue, keyed by slug so a later write coalesces onto the earlier. */
  private readonly queue = new Map<string, QueueEntry>();
  /** Budget-exhausted retries, ≤1 per slug. */
  private readonly pending = new Map<string, QueueEntry>();
  /** Re-entrancy guard so a nested drain is a no-op. */
  private draining = false;

  constructor(opts: HookDispatcherOpts) {
    this.hooks = opts.hooks;
    this.cooldownMs = opts.cooldownMs;
    this.now = opts.now ?? Date.now;
    this.lastFiredAt = opts.lastFiredAt ?? {};
  }

  /**
   * Synchronously queue every matching hook that should fire for `event`, then
   * return. **Never runs a hook.** Returns the entries it enqueued (for tests /
   * diagnostics). Coalesces onto ≤1 entry per slug (latest event wins).
   */
  enqueue(event: WriteEvent): QueueEntry[] {
    const now = this.now();
    const enqueued: QueueEntry[] = [];
    for (const hook of matchDatabaseHooks(this.hooks, event)) {
      const ctx: ShouldFireCtx = {
        hookDepth: event.hookDepth,
        originatingHookSlug: event.originatingHookSlug,
        lastFiredAt: this.lastFiredAt,
        now,
        cooldownMs: this.cooldownMs,
      };
      if (!shouldFireHook(hook, event, ctx).fire) continue;
      const entry: QueueEntry = {
        slug: hook.slug,
        event,
        hookDepth: event.hookDepth + 1,
        enqueuedAt: now,
      };
      this.queue.set(hook.slug, entry); // coalesce
      enqueued.push(entry);
    }
    return enqueued;
  }

  /**
   * Drain the current queue via `run`, on the next tick after the eval unwinds.
   * The queue is **snapshotted and cleared up front**, so any write `run` makes
   * enqueues into a fresh cycle — this drain never sees it (non-re-entrant). A
   * hook whose `run` reports `budgetExhausted` is kept pending (≤1 per slug).
   */
  async drain(run: RunFn): Promise<void> {
    if (this.draining) return; // never re-entrant
    this.draining = true;
    try {
      const entries = [...this.queue.values()];
      this.queue.clear();
      for (const entry of entries) {
        this.lastFiredAt[entry.slug] = this.now(); // mark fired (cooldown)
        const outcome = await run(entry);
        if (outcome && outcome.budgetExhausted) this.enqueuePending(entry);
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Retry the budget-exhausted pending entries via `run`. Called when the budget
   * window has (or may have) rolled. An entry that is STILL budget-exhausted is
   * re-kept pending (≤1 per slug); a successful one is dropped.
   */
  async drainPending(run: RunFn): Promise<void> {
    if (this.draining) return; // share the re-entrancy guard
    this.draining = true;
    try {
      const entries = [...this.pending.values()];
      this.pending.clear();
      for (const entry of entries) {
        this.lastFiredAt[entry.slug] = this.now();
        const outcome = await run(entry);
        if (outcome && outcome.budgetExhausted) this.enqueuePending(entry);
      }
    } finally {
      this.draining = false;
    }
  }

  /** Keep a budget-exhausted entry for retry — deduped to ≤1 per slug. */
  enqueuePending(entry: QueueEntry): void {
    this.pending.set(entry.slug, entry);
  }

  /** The currently queued entries (test/diagnostic view). */
  get queued(): QueueEntry[] {
    return [...this.queue.values()];
  }

  /** The pending (budget-exhausted) slugs — persisted to `hooks-state.json`. */
  get pendingSlugs(): string[] {
    return [...this.pending.keys()];
  }
}

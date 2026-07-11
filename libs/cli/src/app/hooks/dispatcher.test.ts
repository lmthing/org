/**
 * Dispatcher tests ({@link ./dispatcher.ts}) — the decoupled post-commit queue
 * for db-write-originated EVENT dispatch (generalized in S6 from `WriteEvent` to
 * the {@link DispatchEvent} superset; subscribers are matched by source-qualified
 * `on.event` address via `matchEventHooks`).
 *
 * Covers: `enqueue` returns immediately without running (non-re-entrant), matches
 * subscribing EVENT hooks by address, coalesces to ≤1 entry per slug (latest
 * event), stamps `hookDepth = event + 1`; `drain` runs each entry,
 * snapshots+clears so an event enqueued DURING `run` lands in a fresh cycle (never
 * re-entrant), and updates cooldown state; depth cap + self-write exclusion at
 * enqueue time; budget-exhausted → ≤1 coalesced pending entry per slug, retried by
 * `drainPending`; a mixed drain (two addresses, two distinct hooks) keeps
 * independent slug coalescing.
 */

import { describe, expect, it, vi } from 'vitest';

import { HookDispatcher, type QueueEntry } from './dispatcher.js';
import type { DispatchEvent } from './loop-guard.js';
import type { LoadedHook } from './loader.js';

const eventHook = (slug: string, event = 'project/db.raw_items.insert'): LoadedHook => ({
  slug,
  def: { type: 'event', on: { event }, trigger: `x/${slug}#run` },
});

const ev = (over: Partial<DispatchEvent> = {}): DispatchEvent => ({
  address: 'project/db.raw_items.insert',
  payload: { id: '1' },
  hookDepth: 0,
  ...over,
});

/** A controllable clock. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('enqueue — synchronous, non-running', () => {
  it('queues subscribing event hooks and returns before any run happens', () => {
    const d = new HookDispatcher({ hooks: [eventHook('a'), eventHook('b')], cooldownMs: 0 });
    const entries = d.enqueue(ev());
    expect(entries.map((e) => e.slug).sort()).toEqual(['a', 'b']);
    expect(d.queued).toHaveLength(2);
  });

  it('only matches hooks subscribing to the event address', () => {
    const d = new HookDispatcher({
      hooks: [eventHook('a', 'project/db.raw_items.insert'), eventHook('b', 'integration-x/message.posted')],
      cooldownMs: 0,
    });
    expect(d.enqueue(ev()).map((e) => e.slug)).toEqual(['a']);
  });

  it('stamps hookDepth = event.hookDepth + 1', () => {
    const d = new HookDispatcher({ hooks: [eventHook('a')], cooldownMs: 0 });
    const [entry] = d.enqueue(ev({ hookDepth: 1 }));
    expect(entry.hookDepth).toBe(2);
  });

  it('coalesces to ≤1 entry per slug (latest event wins)', () => {
    const d = new HookDispatcher({ hooks: [eventHook('a')], cooldownMs: 0 });
    d.enqueue(ev({ payload: { id: '1' } }));
    d.enqueue(ev({ payload: { id: '2' } }));
    d.enqueue(ev({ payload: { id: '3' } }));
    expect(d.queued).toHaveLength(1);
    expect((d.queued[0].event.payload as { id: string }).id).toBe('3');
  });

  it('honours the depth cap and self-write exclusion at enqueue time', () => {
    const d = new HookDispatcher({ hooks: [eventHook('a'), eventHook('b')], cooldownMs: 0 });
    // Deep event by hook "a": capped out for everyone.
    expect(d.enqueue(ev({ hookDepth: 3, originatingHookSlug: 'a' }))).toHaveLength(0);
    // Shallow event by "a": excludes "a", still fires "b".
    const entries = d.enqueue(ev({ hookDepth: 1, originatingHookSlug: 'a' }));
    expect(entries.map((e) => e.slug)).toEqual(['b']);
  });
});

describe('drain — runs entries, non-re-entrant', () => {
  it('runs each queued entry once and clears the queue', async () => {
    const d = new HookDispatcher({ hooks: [eventHook('a'), eventHook('b')], cooldownMs: 0 });
    d.enqueue(ev());
    const run = vi.fn(async () => {});
    await d.drain(run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(d.queued).toHaveLength(0);
  });

  it('an event enqueued DURING run lands in a fresh cycle, not the current drain', async () => {
    const c = clock();
    const d = new HookDispatcher({
      hooks: [eventHook('a', 'project/db.docs.insert'), eventHook('b', 'project/db.labs.insert')],
      cooldownMs: 0,
      now: c.now,
    });
    d.enqueue(ev({ address: 'project/db.docs.insert' })); // queues "a"
    const ran: string[] = [];
    const run = async (entry: QueueEntry) => {
      ran.push(entry.slug);
      if (entry.slug === 'a') {
        // The hook produces a `labs` event that "b" subscribes to — deeper depth.
        d.enqueue(ev({ address: 'project/db.labs.insert', hookDepth: entry.hookDepth, originatingHookSlug: 'a' }));
      }
    };
    await d.drain(run);
    // Only "a" ran this cycle; "b" is queued for the NEXT drain (not re-entrant).
    expect(ran).toEqual(['a']);
    expect(d.queued.map((e) => e.slug)).toEqual(['b']);

    await d.drain(run);
    expect(ran).toEqual(['a', 'b']);
  });

  it('a mixed drain (two addresses hitting two distinct hooks) coalesces per slug independently', async () => {
    const d = new HookDispatcher({
      hooks: [eventHook('raw', 'project/db.posts.insert'), eventHook('typed', 'project/post.created')],
      cooldownMs: 0,
    });
    // A synthetic raw-table event + a db-emitter typed event, both from one write.
    d.enqueue(ev({ address: 'project/db.posts.insert', payload: { id: 'p1' } }));
    d.enqueue(ev({ address: 'project/post.created', payload: { id: 'p1', title: 'hi' } }));
    expect(d.queued.map((e) => e.slug).sort()).toEqual(['raw', 'typed']);

    const ran: Array<{ slug: string; address: string }> = [];
    await d.drain(async (entry) => {
      ran.push({ slug: entry.slug, address: entry.event.address });
    });
    expect(ran.sort((x, y) => x.slug.localeCompare(y.slug))).toEqual([
      { slug: 'raw', address: 'project/db.posts.insert' },
      { slug: 'typed', address: 'project/post.created' },
    ]);
  });

  it('updates cooldown state so a rapid re-enqueue after drain is suppressed', async () => {
    const c = clock();
    const d = new HookDispatcher({ hooks: [eventHook('a')], cooldownMs: 10_000, now: c.now });
    d.enqueue(ev());
    await d.drain(async () => {});
    expect(d.lastFiredAt.a).toBe(c.now());
    // Immediately re-enqueue: cooldown suppresses it.
    c.advance(500);
    expect(d.enqueue(ev())).toHaveLength(0);
    // After the window elapses it fires again.
    c.advance(10_000);
    expect(d.enqueue(ev())).toHaveLength(1);
  });
});

describe('budget-exhaustion queue', () => {
  it('keeps ≤1 coalesced pending entry per slug and retries on the next drain', async () => {
    const c = clock();
    const d = new HookDispatcher({ hooks: [eventHook('a')], cooldownMs: 0, now: c.now });

    // Two bursts, each exhausts budget → still a single pending entry for "a".
    d.enqueue(ev({ payload: { id: '1' } }));
    await d.drain(async () => ({ budgetExhausted: true }));
    d.enqueue(ev({ payload: { id: '2' } }));
    await d.drain(async () => ({ budgetExhausted: true }));
    expect(d.pendingSlugs).toEqual(['a']);

    // The window "rolls": retry succeeds → pending drained, runs once.
    const run = vi.fn(async () => {});
    await d.drainPending(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.pendingSlugs).toEqual([]);
  });

  it('re-keeps a pending entry that is still budget-exhausted on retry', async () => {
    const d = new HookDispatcher({ hooks: [eventHook('a')], cooldownMs: 0 });
    d.enqueue(ev());
    await d.drain(async () => ({ budgetExhausted: true }));
    expect(d.pendingSlugs).toEqual(['a']);
    await d.drainPending(async () => ({ budgetExhausted: true }));
    expect(d.pendingSlugs).toEqual(['a']); // still pending, still ≤1
  });

  it('a non-exhausted run leaves nothing pending', async () => {
    const d = new HookDispatcher({ hooks: [eventHook('a')], cooldownMs: 0 });
    d.enqueue(ev());
    await d.drain(async () => {});
    expect(d.pendingSlugs).toEqual([]);
  });
});

/**
 * Dispatcher tests ({@link ./dispatcher.ts}) — the decoupled post-commit queue.
 *
 * Covers: `enqueue` returns immediately without running (non-re-entrant),
 * coalesces to ≤1 entry per slug (latest event), stamps `hookDepth = event + 1`;
 * `drain` runs each entry, snapshots+clears so a write DURING `run` lands in a
 * fresh cycle (never re-entrant), and updates cooldown state; depth cap + self-
 * write exclusion are honoured at enqueue time; budget-exhausted → ≤1 coalesced
 * pending entry per slug, retried by `drainPending` once the window "rolls".
 */

import { describe, expect, it, vi } from 'vitest';

import { HookDispatcher, type QueueEntry } from './dispatcher.js';
import type { WriteEvent } from './loop-guard.js';
import type { LoadedHook } from './loader.js';

const dbHook = (slug: string, table = 'raw_items', event: 'insert' | 'update' | 'remove' = 'insert'): LoadedHook => ({
  slug,
  def: { type: 'database', on: { table, event }, trigger: `x/${slug}#run` },
});

const write = (over: Partial<WriteEvent> = {}): WriteEvent => ({
  table: 'raw_items',
  event: 'insert',
  rows: [{ id: '1' }],
  hookDepth: 0,
  ...over,
});

/** A controllable clock. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('enqueue — synchronous, non-running', () => {
  it('queues matching hooks and returns before any run happens', () => {
    const d = new HookDispatcher({ hooks: [dbHook('a'), dbHook('b')], cooldownMs: 0 });
    const entries = d.enqueue(write());
    expect(entries.map((e) => e.slug).sort()).toEqual(['a', 'b']);
    expect(d.queued).toHaveLength(2);
  });

  it('stamps hookDepth = event.hookDepth + 1', () => {
    const d = new HookDispatcher({ hooks: [dbHook('a')], cooldownMs: 0 });
    const [entry] = d.enqueue(write({ hookDepth: 1 }));
    expect(entry.hookDepth).toBe(2);
  });

  it('coalesces to ≤1 entry per slug (latest event wins)', () => {
    const d = new HookDispatcher({ hooks: [dbHook('a')], cooldownMs: 0 });
    d.enqueue(write({ rows: [{ id: '1' }] }));
    d.enqueue(write({ rows: [{ id: '2' }] }));
    d.enqueue(write({ rows: [{ id: '3' }] }));
    expect(d.queued).toHaveLength(1);
    expect((d.queued[0].event.rows[0] as { id: string }).id).toBe('3');
  });

  it('honours the depth cap and self-write exclusion at enqueue time', () => {
    const d = new HookDispatcher({ hooks: [dbHook('a'), dbHook('b')], cooldownMs: 0 });
    // Deep write by hook "a": capped out for everyone.
    expect(d.enqueue(write({ hookDepth: 3, originatingHookSlug: 'a' }))).toHaveLength(0);
    // Shallow write by "a": excludes "a", still fires "b".
    const entries = d.enqueue(write({ hookDepth: 1, originatingHookSlug: 'a' }));
    expect(entries.map((e) => e.slug)).toEqual(['b']);
  });
});

describe('drain — runs entries, non-re-entrant', () => {
  it('runs each queued entry once and clears the queue', async () => {
    const d = new HookDispatcher({ hooks: [dbHook('a'), dbHook('b')], cooldownMs: 0 });
    d.enqueue(write());
    const run = vi.fn(async () => {});
    await d.drain(run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(d.queued).toHaveLength(0);
  });

  it('a write made DURING run enqueues into a fresh cycle, not the current drain', async () => {
    const c = clock();
    const d = new HookDispatcher({ hooks: [dbHook('a'), dbHook('b', 'articles')], cooldownMs: 0, now: c.now });
    d.enqueue(write()); // queues "a"
    const ran: string[] = [];
    const run = async (entry: QueueEntry) => {
      ran.push(entry.slug);
      if (entry.slug === 'a') {
        // The hook writes `articles`, which "b" watches — but at a deeper depth.
        d.enqueue(write({ table: 'articles', hookDepth: entry.hookDepth, originatingHookSlug: 'a' }));
      }
    };
    await d.drain(run);
    // Only "a" ran this cycle; "b" is queued for the NEXT drain (not re-entrant).
    expect(ran).toEqual(['a']);
    expect(d.queued.map((e) => e.slug)).toEqual(['b']);

    await d.drain(run);
    expect(ran).toEqual(['a', 'b']);
  });

  it('updates cooldown state so a rapid re-enqueue after drain is suppressed', async () => {
    const c = clock();
    const d = new HookDispatcher({ hooks: [dbHook('a')], cooldownMs: 10_000, now: c.now });
    d.enqueue(write());
    await d.drain(async () => {});
    expect(d.lastFiredAt.a).toBe(c.now());
    // Immediately re-enqueue: cooldown suppresses it.
    c.advance(500);
    expect(d.enqueue(write())).toHaveLength(0);
    // After the window elapses it fires again.
    c.advance(10_000);
    expect(d.enqueue(write())).toHaveLength(1);
  });
});

describe('budget-exhaustion queue', () => {
  it('keeps ≤1 coalesced pending entry per slug and retries on the next drain', async () => {
    const c = clock();
    const d = new HookDispatcher({ hooks: [dbHook('a')], cooldownMs: 0, now: c.now });

    // Two bursts, each exhausts budget → still a single pending entry for "a".
    d.enqueue(write({ rows: [{ id: '1' }] }));
    await d.drain(async () => ({ budgetExhausted: true }));
    d.enqueue(write({ rows: [{ id: '2' }] }));
    await d.drain(async () => ({ budgetExhausted: true }));
    expect(d.pendingSlugs).toEqual(['a']);

    // The window "rolls": retry succeeds → pending drained, runs once.
    const run = vi.fn(async () => {});
    await d.drainPending(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.pendingSlugs).toEqual([]);
  });

  it('re-keeps a pending entry that is still budget-exhausted on retry', async () => {
    const d = new HookDispatcher({ hooks: [dbHook('a')], cooldownMs: 0 });
    d.enqueue(write());
    await d.drain(async () => ({ budgetExhausted: true }));
    expect(d.pendingSlugs).toEqual(['a']);
    await d.drainPending(async () => ({ budgetExhausted: true }));
    expect(d.pendingSlugs).toEqual(['a']); // still pending, still ≤1
  });

  it('a non-exhausted run leaves nothing pending', async () => {
    const d = new HookDispatcher({ hooks: [dbHook('a')], cooldownMs: 0 });
    d.enqueue(write());
    await d.drain(async () => {});
    expect(d.pendingSlugs).toEqual([]);
  });
});

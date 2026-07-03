/**
 * Loop-guard tests ({@link ./loop-guard.ts}) — the PURE firing policy.
 *
 * Covers: `matchDatabaseHooks` (table + event filter, cron ignored); the three
 * `shouldFireHook` guards — depth cap stops at `HOOK_DEPTH_CAP`, self-write
 * exclusion (own slug excluded, a DIFFERENT hook still fires within cap),
 * cooldown coalesces rapid same-table writes to one fire.
 */

import { describe, expect, it } from 'vitest';

import {
  HOOK_DEPTH_CAP,
  matchDatabaseHooks,
  shouldFireHook,
  type ShouldFireCtx,
  type WriteEvent,
} from './loop-guard.js';
import type { LoadedHook } from './loader.js';

const dbHook = (slug: string, table: string, event: 'insert' | 'update' | 'remove'): LoadedHook => ({
  slug,
  def: { type: 'database', on: { table, event }, trigger: `x/${slug}#run` },
});

const cronHook = (slug: string): LoadedHook => ({
  slug,
  def: { type: 'cron', every: '30m', trigger: `x/${slug}#run` },
});

const write = (over: Partial<WriteEvent> = {}): WriteEvent => ({
  table: 'raw_items',
  event: 'insert',
  rows: [{ id: '1' }],
  hookDepth: 0,
  ...over,
});

const ctx = (over: Partial<ShouldFireCtx> = {}): ShouldFireCtx => ({
  hookDepth: 0,
  lastFiredAt: {},
  now: 1_000_000,
  cooldownMs: 10_000,
  ...over,
});

describe('matchDatabaseHooks', () => {
  it('matches on table + event, ignoring non-matching and cron hooks', () => {
    const hooks = [
      dbHook('a', 'raw_items', 'insert'),
      dbHook('b', 'raw_items', 'update'), // wrong event
      dbHook('c', 'other', 'insert'), // wrong table
      dbHook('d', 'raw_items', 'insert'),
      cronHook('e'),
    ];
    const matched = matchDatabaseHooks(hooks, write());
    expect(matched.map((h) => h.slug)).toEqual(['a', 'd']);
  });

  it('matches update / remove events distinctly', () => {
    const hooks = [dbHook('u', 't', 'update'), dbHook('r', 't', 'remove')];
    expect(matchDatabaseHooks(hooks, write({ table: 't', event: 'update' })).map((h) => h.slug)).toEqual(['u']);
    expect(matchDatabaseHooks(hooks, write({ table: 't', event: 'remove' })).map((h) => h.slug)).toEqual(['r']);
  });
});

describe('shouldFireHook — depth cap', () => {
  const hook = dbHook('a', 'raw_items', 'insert');

  it('fires below the cap', () => {
    for (let d = 0; d < HOOK_DEPTH_CAP; d++) {
      expect(shouldFireHook(hook, write({ hookDepth: d }), ctx({ hookDepth: d })).fire).toBe(true);
    }
  });

  it('stops firing at and beyond the cap', () => {
    for (const d of [HOOK_DEPTH_CAP, HOOK_DEPTH_CAP + 1, 10]) {
      const decision = shouldFireHook(hook, write({ hookDepth: d }), ctx({ hookDepth: d }));
      expect(decision.fire).toBe(false);
      expect(decision.reason).toBe('depth-cap');
    }
  });
});

describe('shouldFireHook — self-write exclusion', () => {
  it("does not refire the hook that made the write, but a DIFFERENT hook does (within cap)", () => {
    const a = dbHook('a', 'raw_items', 'insert');
    const b = dbHook('b', 'raw_items', 'insert');
    // A write made by hook "a"'s own session, one level deep.
    const e = write({ hookDepth: 1, originatingHookSlug: 'a' });
    const c = ctx({ hookDepth: 1, originatingHookSlug: 'a' });

    const selfDecision = shouldFireHook(a, e, c);
    expect(selfDecision.fire).toBe(false);
    expect(selfDecision.reason).toBe('self-write');

    expect(shouldFireHook(b, e, c).fire).toBe(true); // different hook still fires
  });

  it('still respects the depth cap for the different hook', () => {
    const b = dbHook('b', 'raw_items', 'insert');
    const e = write({ hookDepth: HOOK_DEPTH_CAP, originatingHookSlug: 'a' });
    const c = ctx({ hookDepth: HOOK_DEPTH_CAP, originatingHookSlug: 'a' });
    expect(shouldFireHook(b, e, c).reason).toBe('depth-cap');
  });
});

describe('shouldFireHook — cooldown / coalesce', () => {
  const hook = dbHook('a', 'raw_items', 'insert');

  it('blocks a second fire inside the cooldown window (rapid same-table writes coalesce)', () => {
    const now = 1_000_000;
    const c = ctx({ now, cooldownMs: 10_000, lastFiredAt: { a: now - 500 } });
    const decision = shouldFireHook(hook, write(), c);
    expect(decision.fire).toBe(false);
    expect(decision.reason).toBe('cooldown');
  });

  it('allows a fire once the window has elapsed', () => {
    const now = 1_000_000;
    const c = ctx({ now, cooldownMs: 10_000, lastFiredAt: { a: now - 10_000 } });
    expect(shouldFireHook(hook, write(), c).fire).toBe(true);
  });

  it('fires the first time (no prior lastFiredAt)', () => {
    expect(shouldFireHook(hook, write(), ctx()).fire).toBe(true);
  });
});

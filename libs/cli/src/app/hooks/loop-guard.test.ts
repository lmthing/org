/**
 * Loop-guard tests ({@link ./loop-guard.ts}) — the PURE firing + matching policy.
 *
 * Covers: `matchEventHooks` (source-qualified address filter, non-event hooks
 * ignored); the three `shouldFireHook` guards — depth cap stops at
 * `HOOK_DEPTH_CAP`, self-write exclusion (own slug excluded, a DIFFERENT hook
 * still fires within cap), cooldown coalesces rapid same-address events to one
 * fire. (S6 generalized the queue from db writes to the event superset, so the
 * matcher is now `matchEventHooks` and the decision is event-shape-agnostic.)
 */

import { describe, expect, it } from 'vitest';

import { HOOK_DEPTH_CAP, matchEventHooks, shouldFireHook, type ShouldFireCtx } from './loop-guard.js';
import type { LoadedHook } from './loader.js';

const eventHook = (slug: string, event: string): LoadedHook => ({
  slug,
  def: { type: 'event', on: { event }, trigger: `x/${slug}#run` },
});

const cronHook = (slug: string): LoadedHook => ({
  slug,
  def: { type: 'cron', every: '30m', trigger: `x/${slug}#run` },
});

const ctx = (over: Partial<ShouldFireCtx> = {}): ShouldFireCtx => ({
  hookDepth: 0,
  lastFiredAt: {},
  now: 1_000_000,
  cooldownMs: 10_000,
  ...over,
});

describe('matchEventHooks', () => {
  it('matches on the source-qualified address, ignoring non-matching + non-event hooks', () => {
    const hooks = [
      eventHook('a', 'project/db.raw_items.insert'),
      eventHook('b', 'project/db.raw_items.update'), // wrong address
      eventHook('c', 'integration-x/message.posted'), // wrong address
      eventHook('d', 'project/db.raw_items.insert'),
      cronHook('e'), // not an event hook
    ];
    const matched = matchEventHooks(hooks, 'project/db.raw_items.insert');
    expect(matched.map((h) => h.slug)).toEqual(['a', 'd']);
  });

  it('matches distinct addresses distinctly', () => {
    const hooks = [eventHook('u', 'project/db.t.update'), eventHook('r', 'integration-x/message.posted')];
    expect(matchEventHooks(hooks, 'project/db.t.update').map((h) => h.slug)).toEqual(['u']);
    expect(matchEventHooks(hooks, 'integration-x/message.posted').map((h) => h.slug)).toEqual(['r']);
  });
});

describe('shouldFireHook — depth cap', () => {
  const hook = eventHook('a', 'project/db.raw_items.insert');

  it('fires below the cap', () => {
    for (let d = 0; d < HOOK_DEPTH_CAP; d++) {
      expect(shouldFireHook(hook, ctx({ hookDepth: d })).fire).toBe(true);
    }
  });

  it('stops firing at and beyond the cap', () => {
    for (const d of [HOOK_DEPTH_CAP, HOOK_DEPTH_CAP + 1, 10]) {
      const decision = shouldFireHook(hook, ctx({ hookDepth: d }));
      expect(decision.fire).toBe(false);
      expect(decision.reason).toBe('depth-cap');
    }
  });
});

describe('shouldFireHook — self-write exclusion', () => {
  it('does not refire the hook that produced the event, but a DIFFERENT hook does (within cap)', () => {
    const a = eventHook('a', 'project/db.raw_items.insert');
    const b = eventHook('b', 'project/db.raw_items.insert');
    // An event produced by hook "a"'s own session, one level deep.
    const c = ctx({ hookDepth: 1, originatingHookSlug: 'a' });

    const selfDecision = shouldFireHook(a, c);
    expect(selfDecision.fire).toBe(false);
    expect(selfDecision.reason).toBe('self-write');

    expect(shouldFireHook(b, c).fire).toBe(true); // different hook still fires
  });

  it('still respects the depth cap for the different hook', () => {
    const b = eventHook('b', 'project/db.raw_items.insert');
    const c = ctx({ hookDepth: HOOK_DEPTH_CAP, originatingHookSlug: 'a' });
    expect(shouldFireHook(b, c).reason).toBe('depth-cap');
  });
});

describe('shouldFireHook — cooldown / coalesce', () => {
  const hook = eventHook('a', 'project/db.raw_items.insert');

  it('blocks a second fire inside the cooldown window (rapid same-address events coalesce)', () => {
    const now = 1_000_000;
    const c = ctx({ now, cooldownMs: 10_000, lastFiredAt: { a: now - 500 } });
    const decision = shouldFireHook(hook, c);
    expect(decision.fire).toBe(false);
    expect(decision.reason).toBe('cooldown');
  });

  it('allows a fire once the window has elapsed', () => {
    const now = 1_000_000;
    const c = ctx({ now, cooldownMs: 10_000, lastFiredAt: { a: now - 10_000 } });
    expect(shouldFireHook(hook, c).fire).toBe(true);
  });

  it('fires the first time (no prior lastFiredAt)', () => {
    expect(shouldFireHook(hook, ctx()).fire).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { meetsTarget, movement, PLAN_TARGETS } from '../lib/targets.mjs';

describe('PLAN_TARGETS — shape', () => {
  it('every entry declares a label, a better direction, and a unit', () => {
    for (const [id, t] of Object.entries(PLAN_TARGETS)) {
      expect(t.label, id).toBeTruthy();
      expect(['lower', 'higher', 'zero', 'toward']).toContain(t.better);
      expect(t.unit, id).toBeTruthy();
    }
  });
});

describe('meetsTarget', () => {
  it('null value ⇒ null (no verdict without a measurement)', () => {
    expect(meetsTarget('bricking', null)).toBeNull();
  });

  it('a metric with no declared target (e.g. forks) ⇒ null, never true/false', () => {
    expect(meetsTarget('forks', 0)).toBeNull();
    expect(meetsTarget('forks', 999)).toBeNull();
  });

  it('"==" (bricking, target 0): only exactly 0 passes', () => {
    expect(meetsTarget('bricking', 0)).toBe(true);
    expect(meetsTarget('bricking', 1)).toBe(false);
  });

  it('"<" (vocabulary-gap, target < 0.1): the boundary itself fails', () => {
    expect(meetsTarget('vocabulary-gap', 0.05)).toBe(true);
    expect(meetsTarget('vocabulary-gap', 0.1)).toBe(false);
    expect(meetsTarget('vocabulary-gap', 0.2)).toBe(false);
  });

  it('"<=" (retries-per-write, target <= 1): the boundary itself passes', () => {
    expect(meetsTarget('retries-per-write', 1)).toBe(true);
    expect(meetsTarget('retries-per-write', 1.01)).toBe(false);
    expect(meetsTarget('retries-per-write', 0)).toBe(true);
  });

  it('">=" (binding-coverage, target >= 1): only full coverage passes', () => {
    expect(meetsTarget('binding-coverage', 1)).toBe(true);
    expect(meetsTarget('binding-coverage', 0.99)).toBe(false);
  });
});

describe('movement — direction + "did this round improve"', () => {
  it('both null ⇒ unknown/null, never claims a direction from nothing', () => {
    expect(movement('bricking', null, null)).toEqual({ direction: 'unknown', good: null, delta: null });
  });

  it('prev null, now a number ⇒ "appeared" with good:null — a first measurement is not yet progress', () => {
    const m = movement('vocabulary-gap', null, 0.3);
    expect(m.direction).toBe('appeared');
    expect(m.good).toBeNull();
  });

  it('prev a number, now null ⇒ "disappeared" with good:false — losing evidence is never neutral', () => {
    const m = movement('bricking', 0, null);
    expect(m.direction).toBe('disappeared');
    expect(m.good).toBe(false);
  });

  it('better:"lower" (vocabulary-gap): a smaller number is good, a bigger one is bad', () => {
    expect(movement('vocabulary-gap', 0.4, 0.1)).toMatchObject({ direction: 'down', good: true });
    expect(movement('vocabulary-gap', 0.1, 0.4)).toMatchObject({ direction: 'up', good: false });
  });

  it('better:"zero" (bricking): moving down toward 0 is good, moving up is bad, same as "lower"', () => {
    expect(movement('bricking', 1, 0)).toMatchObject({ direction: 'down', good: true });
    expect(movement('bricking', 0, 1)).toMatchObject({ direction: 'up', good: false });
  });

  it('better:"higher" (binding-coverage): a bigger number is good, a smaller one is bad', () => {
    expect(movement('binding-coverage', 0.5, 0.9)).toMatchObject({ direction: 'up', good: true });
    expect(movement('binding-coverage', 0.9, 0.5)).toMatchObject({ direction: 'down', good: false });
  });

  it('better:"toward" (retries-per-write, target 1): getting CLOSER to 1 is good regardless of which side', () => {
    // from above the target, moving down toward 1 — good.
    expect(movement('retries-per-write', 3, 2)).toMatchObject({ direction: 'down', good: true });
    // from below the target, moving up toward 1 — also good ("toward" is symmetric, unlike "lower").
    expect(movement('retries-per-write', 0.2, 0.6)).toMatchObject({ direction: 'up', good: true });
    // overshooting past the target away from it — bad, even though the number went "up" the same way
    // a "lower" metric would call bad, proving toward is NOT just an alias for lower/higher.
    expect(movement('retries-per-write', 1, 3)).toMatchObject({ direction: 'up', good: false });
  });

  it('flat (no change): good is decided by whether the CURRENT value already meets the target', () => {
    const passing = movement('bricking', 0, 0);
    expect(passing).toMatchObject({ direction: 'flat', good: true });
    const failing = movement('bricking', 1, 1);
    expect(failing).toMatchObject({ direction: 'flat', good: false });
  });

  it('a metric with no target (forks) still reports direction, but good is null on flat', () => {
    expect(movement('forks', 10, 10)).toMatchObject({ direction: 'flat', good: null });
    expect(movement('forks', 10, 5)).toMatchObject({ direction: 'down', good: true });
  });
});

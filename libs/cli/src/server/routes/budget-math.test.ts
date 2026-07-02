import { describe, it, expect } from 'vitest';
import {
  DAY_MS,
  parseDurationDays,
  windowBounds,
  sumSpend,
  remainingPct,
  isoDate,
} from './budget-math.js';

describe('parseDurationDays', () => {
  it('parses Nd to whole days', () => {
    expect(parseDurationDays('1d')).toBe(1);
    expect(parseDurationDays('7d')).toBe(7);
    expect(parseDurationDays('30d')).toBe(30);
  });
  it('rounds a legacy Nh up to at least one day', () => {
    expect(parseDurationDays('5h')).toBe(1);
    expect(parseDurationDays('48h')).toBe(2);
  });
  it('returns null for unknown formats', () => {
    expect(parseDurationDays('1mo')).toBeNull();
    expect(parseDurationDays('')).toBeNull();
  });
});

describe('windowBounds (login-anchored)', () => {
  const d0 = Date.UTC(2026, 6, 1); // 2026-07-01

  it('a brand-new account: window starts at the created day', () => {
    const now = d0 + 3 * 3600_000; // same day, +3h
    for (const n of [1, 7, 30]) {
      const { start, reset } = windowBounds(d0, now, n);
      expect(isoDate(start)).toBe('2026-07-01');
      expect(reset - start).toBe(n * DAY_MS);
    }
  });

  it('1d window advances each day, anchored to the created day', () => {
    const now = d0 + 5 * DAY_MS + 1000; // 6 days later
    const { start, reset } = windowBounds(d0, now, 1);
    expect(isoDate(start)).toBe('2026-07-06');
    expect(isoDate(reset)).toBe('2026-07-07');
  });

  it('7d window rolls on the 7-day boundary from the created day, not the calendar', () => {
    // day 8 → second period [D0+7, D0+14)
    const now = d0 + 8 * DAY_MS;
    const { start, reset } = windowBounds(d0, now, 7);
    expect(isoDate(start)).toBe('2026-07-08');
    expect(isoDate(reset)).toBe('2026-07-15');
  });
});

describe('sumSpend', () => {
  const daily = new Map<string, number>([
    ['2026-07-01', 0.264],
    ['2026-07-02', 0.334],
  ]);
  it('sums inclusive of start and today', () => {
    const start = Date.UTC(2026, 6, 1);
    const now = Date.UTC(2026, 6, 2) + 3600_000;
    expect(sumSpend(daily, start, now)).toBeCloseTo(0.598, 3);
  });
  it('counts only days within the window', () => {
    const start = Date.UTC(2026, 6, 2);
    const now = Date.UTC(2026, 6, 2) + 3600_000;
    expect(sumSpend(daily, start, now)).toBeCloseTo(0.334, 3);
  });
});

describe('remainingPct', () => {
  it('computes remaining percentage of the cap', () => {
    expect(remainingPct(6, 0.6)).toBe(90);
    expect(remainingPct(0.3, 0)).toBe(100);
  });
  it('clamps over-spend to 0', () => {
    expect(remainingPct(0.3, 0.334)).toBe(0);
  });
  it('returns null for an invalid cap', () => {
    expect(remainingPct(0, 0)).toBeNull();
  });
});

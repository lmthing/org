import { describe, it, expect } from 'vitest';
import { Budget, BudgetExceededError } from './budget.js';

describe('Budget', () => {
  describe('episodes', () => {
    it('allows ticks up to and including the limit', () => {
      const b = new Budget({ maxEpisodes: 3 });
      expect(() => { b.tickEpisode(); b.tickEpisode(); b.tickEpisode(); }).not.toThrow();
      expect(b.episodes).toBe(3);
    });

    it('throws BudgetExceededError when the episode limit is passed', () => {
      const b = new Budget({ maxEpisodes: 2 });
      b.tickEpisode();
      b.tickEpisode();
      try {
        b.tickEpisode();
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        expect((err as BudgetExceededError).kind).toBe('episodes');
        expect((err as BudgetExceededError).limit).toBe(2);
        expect((err as BudgetExceededError).used).toBe(3);
      }
    });

    it('is unbounded when no episode limit is set', () => {
      const b = new Budget({});
      for (let i = 0; i < 100; i++) b.tickEpisode();
      expect(b.episodes).toBe(100);
    });
  });

  describe('tool calls', () => {
    it('counts in batches and throws past the limit', () => {
      const b = new Budget({ maxToolCalls: 5 });
      b.tickToolCalls(3);
      expect(b.toolCalls).toBe(3);
      b.tickToolCalls(2); // exactly at limit
      expect(b.toolCalls).toBe(5);
      expect(() => b.tickToolCalls(1)).toThrow(BudgetExceededError);
    });

    it('reports the tool-call kind and counts', () => {
      const b = new Budget({ maxToolCalls: 1 });
      try {
        b.tickToolCalls(4);
        expect.unreachable();
      } catch (err) {
        const e = err as BudgetExceededError;
        expect(e.kind).toBe('toolCalls');
        expect(e.used).toBe(4);
      }
    });
  });

  describe('fork depth', () => {
    it('allows depth at or under the limit', () => {
      const b = new Budget({ maxForkDepth: 2 });
      expect(() => b.assertForkDepth(1)).not.toThrow();
      expect(() => b.assertForkDepth(2)).not.toThrow();
    });

    it('throws when depth exceeds the limit', () => {
      const b = new Budget({ maxForkDepth: 1 });
      expect(() => b.assertForkDepth(2)).toThrow(BudgetExceededError);
    });

    it('is unbounded when no depth limit is set', () => {
      const b = new Budget({});
      expect(() => b.assertForkDepth(99)).not.toThrow();
    });
  });

  describe('wall clock', () => {
    it('throws once elapsed time passes the limit (injected clock)', () => {
      let now = 1000;
      const b = new Budget({ maxWallClockMs: 50 }, () => now);
      now = 1040; // 40ms elapsed — under limit
      expect(() => b.tickEpisode()).not.toThrow();
      now = 1060; // 60ms elapsed — over limit
      try {
        b.tickEpisode();
        expect.unreachable();
      } catch (err) {
        expect((err as BudgetExceededError).kind).toBe('wallClock');
      }
    });

    it('assertWallClock can be called independently', () => {
      let now = 0;
      const b = new Budget({ maxWallClockMs: 10 }, () => now);
      now = 5;
      expect(() => b.assertWallClock()).not.toThrow();
      now = 100;
      expect(() => b.assertWallClock()).toThrow(BudgetExceededError);
    });
  });

  describe('snapshot', () => {
    it('reflects live counters and elapsed time', () => {
      let now = 500;
      const b = new Budget({}, () => now);
      b.tickEpisode();
      b.tickToolCalls(2);
      now = 800;
      expect(b.snapshot()).toEqual({ episodes: 1, toolCalls: 2, elapsedMs: 300 });
    });

    it('returns a fresh object each call (no shared mutable state leak)', () => {
      const b = new Budget();
      const s1 = b.snapshot();
      b.tickEpisode();
      const s2 = b.snapshot();
      expect(s1.episodes).toBe(0);
      expect(s2.episodes).toBe(1);
      expect(s1).not.toBe(s2);
    });
  });
});

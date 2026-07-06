/**
 * Cron tests ({@link ./cron.ts}) — PURE.
 *
 * Covers: `parseEvery` unit parsing + the ≥5-minute clamp + malformed throw;
 * `cronIntervalMs` (every vs daily); `dueCronHooks` boot-catch-up (an overdue
 * hook runs once, an immediate re-check is not due; a never-run hook is due);
 * `crontabSchedule` / `nextCrontabLines` field rendering + template expansion.
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_CRON_INTERVAL_MS,
  cronIntervalMs,
  crontabSchedule,
  dueCronHooks,
  nextCrontabLines,
  nextRunAt,
  parseEvery,
} from './cron.js';
import type { CronHookDef, LoadedHook } from './loader.js';
import { emptyHooksState, type HooksState } from './state.js';

const cronHook = (slug: string, def: Partial<CronHookDef> = {}): LoadedHook => ({
  slug,
  def: { type: 'cron', every: '30m', trigger: `x/${slug}#run`, ...def },
});

describe('parseEvery', () => {
  it('parses minutes / hours / days', () => {
    expect(parseEvery('30m')).toBe(30 * 60_000);
    expect(parseEvery('2h')).toBe(2 * 3_600_000);
    expect(parseEvery('1d')).toBe(24 * 3_600_000);
  });

  it('clamps anything under 5 minutes up to 5 minutes', () => {
    expect(parseEvery('1m')).toBe(MIN_CRON_INTERVAL_MS);
    expect(parseEvery('3m')).toBe(MIN_CRON_INTERVAL_MS);
    expect(parseEvery('5m')).toBe(MIN_CRON_INTERVAL_MS);
    expect(parseEvery('6m')).toBe(6 * 60_000);
  });

  it('throws on a malformed spec', () => {
    expect(() => parseEvery('')).toThrow();
    expect(() => parseEvery('30')).toThrow();
    expect(() => parseEvery('30s')).toThrow();
    expect(() => parseEvery('abc')).toThrow();
  });
});

describe('cronIntervalMs', () => {
  it('uses parseEvery for `every` and 24h for `daily`', () => {
    expect(cronIntervalMs({ type: 'cron', every: '2h', trigger: 't' })).toBe(2 * 3_600_000);
    expect(cronIntervalMs({ type: 'cron', daily: '08:00', trigger: 't' })).toBe(24 * 3_600_000);
  });
});

describe('dueCronHooks — boot catch-up', () => {
  const now = 1_000_000_000;

  it('returns a never-run hook (due immediately)', () => {
    const hooks = [cronHook('a', { every: '30m' })];
    expect(dueCronHooks(hooks, emptyHooksState(), now).map((h) => h.slug)).toEqual(['a']);
  });

  it('returns an overdue hook once; an immediate re-check (lastRunAt = now) is not due', () => {
    const hooks = [cronHook('a', { every: '30m' })];
    const overdue: HooksState = { ...emptyHooksState(), cron: { a: { lastRunAt: now - 31 * 60_000 } } };
    const due = dueCronHooks(hooks, overdue, now);
    expect(due.map((h) => h.slug)).toEqual(['a']);

    // Simulate the integrator marking it run — re-check yields nothing.
    const after: HooksState = { ...overdue, cron: { a: { lastRunAt: now } } };
    expect(dueCronHooks(hooks, after, now)).toEqual([]);
  });

  it('does not return a hook still inside its interval', () => {
    const hooks = [cronHook('a', { every: '30m' })];
    const recent: HooksState = { ...emptyHooksState(), cron: { a: { lastRunAt: now - 10 * 60_000 } } };
    expect(dueCronHooks(hooks, recent, now)).toEqual([]);
  });

  it('ignores database hooks', () => {
    const dbHook: LoadedHook = { slug: 'db', def: { type: 'database', on: { table: 't', event: 'insert' }, trigger: 'x/y#z' } };
    expect(dueCronHooks([dbHook], emptyHooksState(), now)).toEqual([]);
  });
});

describe('crontabSchedule', () => {
  it('renders `daily:HH:MM` as `MM HH * * *`', () => {
    expect(crontabSchedule({ type: 'cron', daily: '08:00', trigger: 't' })).toBe('0 8 * * *');
    expect(crontabSchedule({ type: 'cron', daily: '18:30', trigger: 't' })).toBe('30 18 * * *');
  });

  it('renders sub-hour `every` as a minute step (≥5m)', () => {
    expect(crontabSchedule({ type: 'cron', every: '30m', trigger: 't' })).toBe('*/30 * * * *');
    expect(crontabSchedule({ type: 'cron', every: '1m', trigger: 't' })).toBe('*/5 * * * *'); // clamped
  });

  it('renders hour / day intervals', () => {
    expect(crontabSchedule({ type: 'cron', every: '2h', trigger: 't' })).toBe('0 */2 * * *');
    expect(crontabSchedule({ type: 'cron', every: '1d', trigger: 't' })).toBe('0 0 */1 * *');
  });
});

describe('nextRunAt', () => {
  it('daily fires at the wall-clock HH:MM — next occurrence after fromMs (drift fix)', () => {
    // At local 10:00, the 09:00 daily has passed today → next is tomorrow 09:00,
    // NOT `fromMs + 24h` (10:00), which was the historical drift bug.
    const t = new Date(2026, 0, 1, 10, 0, 0, 0).getTime();
    const d = new Date(nextRunAt({ type: 'cron', daily: '09:00', trigger: 't' }, t));
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(2); // rolled to the next day
  });

  it('daily returns today when the time is still ahead', () => {
    const t = new Date(2026, 0, 1, 8, 0, 0, 0).getTime(); // 08:00
    const next = nextRunAt({ type: 'cron', daily: '09:00', trigger: 't' }, t);
    expect(next - t).toBe(60 * 60_000); // same-day 09:00, one hour later
  });

  it('every-N-minutes lands on epoch-aligned boundaries strictly after fromMs', () => {
    const i = 30 * 60_000;
    expect(nextRunAt({ type: 'cron', every: '30m', trigger: 't' }, i)).toBe(2 * i); // on boundary → next
    expect(nextRunAt({ type: 'cron', every: '30m', trigger: 't' }, i + 5 * 60_000)).toBe(2 * i); // mid → next
  });

  it('every-N-hours / N-days align to the interval', () => {
    const h = 2 * 3_600_000;
    expect(nextRunAt({ type: 'cron', every: '2h', trigger: 't' }, h + 1)).toBe(2 * h);
    const day = 24 * 3_600_000;
    expect(nextRunAt({ type: 'cron', every: '1d', trigger: 't' }, day + 1)).toBe(2 * day);
  });

  it('a never-run hook (fromMs=0) yields a past time ⇒ due immediately', () => {
    const now = Date.now();
    expect(nextRunAt({ type: 'cron', daily: '09:00', trigger: 't' }, 0)).toBeLessThan(now);
    expect(nextRunAt({ type: 'cron', every: '30m', trigger: 't' }, 0)).toBeLessThan(now);
  });
});

describe('nextCrontabLines', () => {
  it('emits one line per cron hook with the slug expanded into the template', () => {
    const hooks = [cronHook('refresh', { every: '30m' }), cronHook('digest', { daily: '08:00' })];
    const lines = nextCrontabLines(hooks, 'curl -X POST http://localhost:8787/api/projects/blog/hooks/{slug}/run');
    expect(lines).toEqual([
      '*/30 * * * * curl -X POST http://localhost:8787/api/projects/blog/hooks/refresh/run',
      '0 8 * * * curl -X POST http://localhost:8787/api/projects/blog/hooks/digest/run',
    ]);
  });

  it('supports a `:slug` placeholder and skips database hooks', () => {
    const hooks: LoadedHook[] = [
      cronHook('a', { every: '2h' }),
      { slug: 'db', def: { type: 'database', on: { table: 't', event: 'insert' }, trigger: 'x/y#z' } },
    ];
    const lines = nextCrontabLines(hooks, 'hit /hooks/:slug/run');
    expect(lines).toEqual(['0 */2 * * * hit /hooks/a/run']);
  });
});

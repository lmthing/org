/**
 * Hook **cron scheduling** (Phase 6, 6A) — PURE.
 *
 * Cron is driven by the pod's `crond` hitting a local hook-run endpoint (6C):
 * {@link nextCrontabLines} renders one crontab line per cron hook. Between ticks
 * (and on boot), {@link dueCronHooks} decides — from the injected `now` and the
 * persisted `{ lastRunAt }` — which cron hooks are overdue, which powers the
 * boot-catch-up ("a window missed while the pod was down runs once").
 *
 * Everything here is pure: the clock and the last-run state are injected, so due
 * checks + crontab rendering are exhaustively unit-testable with no real timers.
 *
 * Granularity is clamped to **≥5 minutes** ({@link MIN_CRON_INTERVAL_MS}) — both
 * the parsed interval and the crontab minute field — matching what a real crond
 * can dependably deliver.
 */

import type { CronHookDef, LoadedHook } from './loader.js';
import type { HooksState } from './state.js';

/** The minimum cron granularity — 5 minutes. */
export const MIN_CRON_INTERVAL_MS = 5 * 60_000;

/** Milliseconds in a day (the interval a `daily:` hook is treated as). */
const DAY_MS = 24 * 60 * 60_000;

/**
 * Parse an `every` spec (`'30m' | '2h' | '1d'`) to milliseconds, **clamped to
 * ≥5min**. Throws on a malformed spec.
 */
export function parseEvery(spec: string): number {
  const m = /^(\d+)([mhd])$/.exec(spec.trim());
  if (!m) throw new Error(`[cron] invalid \`every\` spec "${spec}" (expected e.g. '30m'|'2h'|'1d')`);
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === 'm' ? n * 60_000 : unit === 'h' ? n * 3_600_000 : n * DAY_MS;
  return Math.max(ms, MIN_CRON_INTERVAL_MS);
}

/** The interval (ms) a cron hook repeats at — `every` parsed, or 24h for `daily`.
 *  Used as the manifest `everyMs` (cadence hint); dueness itself uses
 *  {@link nextRunAt}, which is wall-clock accurate. */
export function cronIntervalMs(def: CronHookDef): number {
  if (def.every) return parseEvery(def.every);
  return DAY_MS; // `daily:` cadence is 24h; the exact fire time comes from nextRunAt
}

/**
 * The next wall-clock time (epoch-ms) this hook should fire, strictly after
 * `fromMs` (its persisted `lastRunAt`). This is the single source of dueness for
 * both the pod's boot catch-up ({@link dueCronHooks}) and the gateway-published
 * cron manifest, so the gateway wakes the pod at exactly the minute the pod would
 * consider the hook due.
 *
 *   - `daily:'HH:MM'` → the next occurrence of HH:MM after `fromMs`. **This fixes
 *     the historical drift bug** where a daily hook re-fired 24h after whenever it
 *     was last caught up instead of at its wall-clock time.
 *   - `every:'Nm|Nh|Nd'` → the next epoch-aligned boundary of the interval
 *     (drift-free; for intervals that divide evenly into an hour/day this
 *     coincides with the natural wall-clock slots, e.g. every 30m → :00/:30).
 *
 * A never-run hook (`fromMs = 0`) yields a long-past time, so it is due
 * immediately (fires once on first boot, then tracks its real schedule). Pure.
 */
export function nextRunAt(def: CronHookDef, fromMs: number): number {
  if (def.daily) {
    const [hh, mm] = def.daily.split(':').map(Number);
    const next = new Date(fromMs);
    next.setHours(hh ?? 0, mm ?? 0, 0, 0);
    if (next.getTime() <= fromMs) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  const intervalMs = parseEvery(def.every ?? '5m'); // clamped ≥5min
  // Next multiple of intervalMs strictly greater than fromMs (epoch-aligned).
  return Math.floor(fromMs / intervalMs) * intervalMs + intervalMs;
}

/**
 * The cron hooks that are due at `now`, per the persisted `lastRunAt`. A hook is
 * due when `now - lastRunAt >= interval` (a never-run hook has `lastRunAt` 0, so
 * it is due immediately). Each due hook appears **once** (coalesced) — the caller
 * updates `state.cron[slug].lastRunAt = now` after running, so an immediate
 * re-check returns nothing. Pure.
 */
export function dueCronHooks(hooks: LoadedHook[], state: HooksState, now: number): LoadedHook[] {
  return hooks.filter((h) => {
    if (h.def.type !== 'cron') return false;
    const lastRunAt = state.cron[h.slug]?.lastRunAt ?? 0;
    return now >= nextRunAt(h.def, lastRunAt);
  });
}

/**
 * Render one crontab line per cron hook. `endpointUrlTemplate` is expanded with
 * the hook slug (both `{slug}` and `:slug` placeholders are supported), e.g.
 * `curl -fsS -X POST http://localhost:8787/api/projects/blog/hooks/{slug}/run`.
 * The schedule field honours the ≥5-minute granularity.
 */
export function nextCrontabLines(hooks: LoadedHook[], endpointUrlTemplate: string): string[] {
  return hooks
    .filter((h): h is LoadedHook & { def: CronHookDef } => h.def.type === 'cron')
    .map((h) => `${crontabSchedule(h.def)} ${expandTemplate(endpointUrlTemplate, h.slug)}`);
}

/** Build the 5-field crontab schedule for a cron hook (≥5-minute granularity). */
export function crontabSchedule(def: CronHookDef): string {
  if (def.daily) {
    const [hh, mm] = def.daily.split(':');
    return `${Number(mm)} ${Number(hh)} * * *`;
  }
  const minutes = Math.round(parseEvery(def.every ?? '5m') / 60_000); // parseEvery clamps ≥5m
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `0 */${hours} * * *`;
  const days = Math.max(1, Math.round(hours / 24));
  return `0 0 */${days} * *`;
}

/** Expand `{slug}` / `:slug` placeholders in a URL/command template. */
function expandTemplate(template: string, slug: string): string {
  return template.replace(/\{slug\}/g, slug).replace(/:slug\b/g, slug);
}

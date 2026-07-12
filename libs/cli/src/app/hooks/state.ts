/**
 * Hook **persisted state** (Phase 6, 6A) — `<projectRoot>/.data/hooks-state.json`.
 *
 * This is the small amount of hook state that must survive a pod restart:
 *   - `lastFiredAt` — per-slug cooldown clock (so a restart doesn't refire a hook
 *     that just fired);
 *   - `cron`       — per-slug `{ lastRunAt }`, the source of cron boot-catch-up
 *     (a window missed while the pod was down runs once on boot — see 6C);
 *   - `pending`    — the budget-exhausted retry slugs ({@link HookDispatcher}).
 *
 * The load/save are the only I/O in the hooks module; everything that *decides*
 * (loop-guard, cron) is pure and takes this state as data.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The on-disk hook state. */
export interface HooksState {
  /** Per-slug last-fired epoch-ms (cooldown). */
  lastFiredAt: Record<string, number>;
  /** Per-slug cron last-run marker (boot-catch-up + due checks). */
  cron: Record<string, { lastRunAt: number }>;
  /** Budget-exhausted retry slugs. */
  pending: string[];
  /** Slugs disabled from the settings UI — the overlay OR'd with a hook's own
   *  `def.disabled` to decide whether it is inert (see {@link effectiveDisabled}). */
  disabled: string[];
}

/** A fresh, empty state. */
export function emptyHooksState(): HooksState {
  return { lastFiredAt: {}, cron: {}, pending: [], disabled: [] };
}

/** The canonical on-disk path for a project's hook state. */
export function hooksStatePath(projectRoot: string): string {
  return join(projectRoot, '.data', 'hooks-state.json');
}

/**
 * Load the hook state, tolerating a missing/corrupt file (returns a fresh empty
 * state) and normalising partial shapes so callers always get all three fields.
 */
export async function loadHooksState(projectRoot: string): Promise<HooksState> {
  let text: string;
  try {
    text = await readFile(hooksStatePath(projectRoot), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyHooksState();
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyHooksState(); // corrupt → start clean (state is a cache, not truth)
  }
  return normalizeHooksState(raw);
}

/** Persist the hook state (creating `.data/` if needed). */
export async function saveHooksState(projectRoot: string, state: HooksState): Promise<void> {
  const path = hooksStatePath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8');
}

/** Coerce an arbitrary parsed value into a well-formed {@link HooksState}. */
export function normalizeHooksState(raw: unknown): HooksState {
  const state = emptyHooksState();
  if (raw === null || typeof raw !== 'object') return state;
  const obj = raw as Record<string, unknown>;

  if (obj.lastFiredAt && typeof obj.lastFiredAt === 'object') {
    for (const [slug, v] of Object.entries(obj.lastFiredAt as Record<string, unknown>)) {
      if (typeof v === 'number') state.lastFiredAt[slug] = v;
    }
  }
  if (obj.cron && typeof obj.cron === 'object') {
    for (const [slug, v] of Object.entries(obj.cron as Record<string, unknown>)) {
      const lastRunAt = (v as Record<string, unknown> | null)?.lastRunAt;
      if (typeof lastRunAt === 'number') state.cron[slug] = { lastRunAt };
    }
  }
  if (Array.isArray(obj.pending)) {
    state.pending = obj.pending.filter((s): s is string => typeof s === 'string');
  }
  if (Array.isArray(obj.disabled)) {
    state.disabled = obj.disabled.filter((s): s is string => typeof s === 'string');
  }
  return state;
}

/**
 * The disabled-slug overlay, read **synchronously** (best-effort; `[]` on any
 * missing/corrupt file). Used on the hot event-dispatch drain path where adding an
 * `await` would perturb the drain's microtask ordering — a sync read keeps timing
 * identical while still honoring a live UI toggle.
 */
export function disabledSlugsSync(projectRoot: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(hooksStatePath(projectRoot), 'utf8')) as { disabled?: unknown };
    return Array.isArray(raw.disabled) ? raw.disabled.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Effective-disabled = a hook is inert when EITHER its export sets `disabled: true`
 * OR the settings-UI overlay ({@link HooksState.disabled}) lists its slug. Every
 * activation/registration site skips a hook for which this returns true.
 */
export function effectiveDisabled(
  hook: { slug: string; def?: { disabled?: boolean } },
  state: HooksState,
): boolean {
  return hook.def?.disabled === true || state.disabled.includes(hook.slug);
}

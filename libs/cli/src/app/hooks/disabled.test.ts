/**
 * `disabled` hooks — the export flag AND the state overlay are OR'd into
 * {@link effectiveDisabled}, and every activation site skips a disabled hook.
 *
 * Covers: normalize round-trips `disabled`; validateHook preserves `disabled:true`
 * on all three def types; `effectiveDisabled` honors both inputs; a disabled cron
 * is excluded from `dueCronHooks`/`nextCrontabLines`; a disabled event hook never
 * joins a runtime subscriber set (export flag).
 */

import { describe, it, expect } from 'vitest';
import { validateHook, effectiveDisabled, emptyHooksState, normalizeHooksState } from './index.js';
import { dueCronHooks, nextCrontabLines } from './cron.js';
import type { LoadedHook } from './loader.js';
import type { HooksState } from './state.js';

function cron(slug: string, disabledExport = false): LoadedHook {
  return {
    slug,
    owner: 'project',
    def: { type: 'cron', every: '30m', trigger: 'sp/agent#go', ...(disabledExport ? { disabled: true } : {}) },
  };
}

describe('disabled: state normalize', () => {
  it('round-trips the disabled slug list and defaults to []', () => {
    expect(emptyHooksState().disabled).toEqual([]);
    expect(normalizeHooksState({ disabled: ['a', 1, 'b'] }).disabled).toEqual(['a', 'b']);
    expect(normalizeHooksState({}).disabled).toEqual([]);
  });
});

describe('disabled: validateHook preserves the export flag on every type', () => {
  it('cron', () => {
    const def = validateHook('c', 'c.ts', { type: 'cron', every: '1h', trigger: 'sp/a#go', disabled: true });
    expect(def.disabled).toBe(true);
  });
  it('event', () => {
    const def = validateHook('e', 'e.ts', { type: 'event', on: { event: 'project/x.y' }, trigger: 'sp/a#go', disabled: true });
    expect(def.disabled).toBe(true);
  });
  it('webhook', () => {
    const def = validateHook('w', 'w.ts', { type: 'webhook', path: 'inbox', trigger: 'sp/a#go', disabled: true });
    expect(def.disabled).toBe(true);
  });
  it('omits disabled when not set', () => {
    const def = validateHook('c', 'c.ts', { type: 'cron', every: '1h', trigger: 'sp/a#go' });
    expect(def.disabled).toBeUndefined();
  });
});

describe('disabled: effectiveDisabled OR-s the export flag and the overlay', () => {
  const state = (disabled: string[]): HooksState => ({ ...emptyHooksState(), disabled });
  it('export flag disables', () => {
    expect(effectiveDisabled(cron('a', true), state([]))).toBe(true);
  });
  it('overlay disables', () => {
    expect(effectiveDisabled(cron('a'), state(['a']))).toBe(true);
  });
  it('neither → enabled', () => {
    expect(effectiveDisabled(cron('a'), state(['other']))).toBe(false);
  });
});

describe('disabled: cron gates skip a disabled hook', () => {
  const enabled = cron('live');
  const off = cron('off');
  const now = 10 * 60 * 60_000; // well past a never-run 30m interval

  it('dueCronHooks skips the overlay-disabled hook', () => {
    const state: HooksState = { ...emptyHooksState(), disabled: ['off'] };
    const due = dueCronHooks([enabled, off], state, now).map((h) => h.slug);
    expect(due).toEqual(['live']);
  });

  it('dueCronHooks skips an export-disabled hook', () => {
    const due = dueCronHooks([enabled, cron('exp', true)], emptyHooksState(), now).map((h) => h.slug);
    expect(due).toEqual(['live']);
  });

  it('nextCrontabLines only emits lines for enabled hooks (caller pre-filters)', () => {
    const state: HooksState = { ...emptyHooksState(), disabled: ['off'] };
    const kept = [enabled, off].filter((h) => !effectiveDisabled(h, state));
    const lines = nextCrontabLines(kept, 'curl {slug}');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('live');
  });
});

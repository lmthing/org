/**
 * State tests ({@link ./state.ts}) — hooks-state.json load/save/normalise.
 *
 * Covers: missing file → empty state; save → load round-trip; corrupt JSON →
 * empty; partial/garbage shapes normalised (numbers-only lastFiredAt, cron
 * lastRunAt, string-only pending).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  emptyHooksState,
  hooksStatePath,
  loadHooksState,
  normalizeHooksState,
  saveHooksState,
  type HooksState,
} from './state.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hooks-state-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('load / save', () => {
  it('returns an empty state when the file is missing', async () => {
    expect(await loadHooksState(root)).toEqual(emptyHooksState());
  });

  it('round-trips through save → load', async () => {
    const state: HooksState = {
      lastFiredAt: { a: 111 },
      cron: { refresh: { lastRunAt: 222 } },
      pending: ['synth'],
      disabled: ['old-cron'],
    };
    await saveHooksState(root, state);
    expect(await loadHooksState(root)).toEqual(state);
  });

  it('returns an empty state for corrupt JSON', async () => {
    mkdirSync(join(root, '.data'), { recursive: true });
    writeFileSync(hooksStatePath(root), '{ not json', 'utf8');
    expect(await loadHooksState(root)).toEqual(emptyHooksState());
  });
});

describe('normalizeHooksState', () => {
  it('drops non-number / non-string garbage and fills missing fields', () => {
    const normalised = normalizeHooksState({
      lastFiredAt: { a: 5, b: 'nope' },
      cron: { c: { lastRunAt: 9 }, d: { lastRunAt: 'x' }, e: null },
      pending: ['ok', 42, null],
      disabled: ['keep', 7, null],
    });
    expect(normalised).toEqual({
      lastFiredAt: { a: 5 },
      cron: { c: { lastRunAt: 9 } },
      pending: ['ok'],
      disabled: ['keep'],
    });
  });

  it('normalises a non-object to empty', () => {
    expect(normalizeHooksState(null)).toEqual(emptyHooksState());
    expect(normalizeHooksState(42)).toEqual(emptyHooksState());
  });
});

import { describe, it, expect } from 'vitest';
import {
  HARNESS_IDS,
  DEFAULT_HARNESS,
  isHarnessId,
  coerceHarnessId,
  harnessEnvDefault,
  resolveHarness,
} from './harness.js';

describe('harness ids', () => {
  it('knows exactly lmthing and dsh', () => {
    expect([...HARNESS_IDS]).toEqual(['lmthing', 'dsh']);
    expect(DEFAULT_HARNESS).toBe('lmthing');
  });

  it('isHarnessId accepts known ids and rejects everything else', () => {
    expect(isHarnessId('lmthing')).toBe(true);
    expect(isHarnessId('dsh')).toBe(true);
    expect(isHarnessId('other')).toBe(false);
    expect(isHarnessId(undefined)).toBe(false);
    expect(isHarnessId(3)).toBe(false);
  });

  it('coerceHarnessId narrows or returns undefined', () => {
    expect(coerceHarnessId('dsh')).toBe('dsh');
    expect(coerceHarnessId('nope')).toBeUndefined();
    expect(coerceHarnessId(null)).toBeUndefined();
  });
});

describe('harnessEnvDefault', () => {
  it('reads LMTHING_HARNESS when valid, else undefined', () => {
    expect(harnessEnvDefault({ LMTHING_HARNESS: 'dsh' })).toBe('dsh');
    expect(harnessEnvDefault({ LMTHING_HARNESS: 'bogus' })).toBeUndefined();
    expect(harnessEnvDefault({})).toBeUndefined();
  });
});

describe('resolveHarness precedence', () => {
  it('project value wins over env default', () => {
    expect(resolveHarness('lmthing', 'dsh')).toBe('lmthing');
    expect(resolveHarness('dsh', 'lmthing')).toBe('dsh');
  });

  it('falls back to env default when project has no valid preference', () => {
    expect(resolveHarness(undefined, 'dsh')).toBe('dsh');
    expect(resolveHarness('garbage', 'dsh')).toBe('dsh');
  });

  it('falls back to DEFAULT_HARNESS when nothing is set', () => {
    expect(resolveHarness(undefined, undefined)).toBe('lmthing');
    expect(resolveHarness('garbage', 'garbage')).toBe('lmthing');
  });
});

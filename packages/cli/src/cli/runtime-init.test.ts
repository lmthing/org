import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeRuntime, runtimeNeedsInit } from './runtime-init.js';

describe('runtime-init', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'lmthing-runtime-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('runtimeNeedsInit is true for a fresh root', () => {
    expect(runtimeNeedsInit(root)).toBe(true);
  });

  it('runtimeNeedsInit stays true for an EMPTY system/ dir (the repair regression)', () => {
    // A persistent volume can carry an empty system/ from a prior broken
    // materialization. The guard must NOT treat the bare dir as "initialized" —
    // otherwise the system spaces are never (re)populated and every session
    // fails with `Agent "thing" not found`.
    mkdirSync(join(root, 'system'), { recursive: true });
    expect(runtimeNeedsInit(root)).toBe(true);
  });

  it('materializeRuntime copies system spaces (incl. thing) and the user skeleton', () => {
    const copied = materializeRuntime(root);
    expect(copied).toBeGreaterThan(0);
    expect(existsSync(join(root, 'system', 'thing'))).toBe(true);
    expect(existsSync(join(root, 'system', 'thing', 'agents'))).toBe(true);
    expect(existsSync(join(root, 'user', 'spaces'))).toBe(true);
    expect(existsSync(join(root, 'user', 'project.json'))).toBe(true);
    // After materialization the guard reports satisfied.
    expect(runtimeNeedsInit(root)).toBe(false);
  });

  it('materializeRuntime repairs an empty system/ dir', () => {
    mkdirSync(join(root, 'system'), { recursive: true });
    expect(runtimeNeedsInit(root)).toBe(true);
    materializeRuntime(root);
    expect(runtimeNeedsInit(root)).toBe(false);
    expect(existsSync(join(root, 'system', 'thing'))).toBe(true);
  });

  it('materializeRuntime does not overwrite existing user files', () => {
    materializeRuntime(root);
    const projectJson = join(root, 'user', 'project.json');
    writeFileSync(projectJson, '{"id":"user","name":"Custom"}', 'utf8');
    materializeRuntime(root);
    expect(existsSync(projectJson)).toBe(true);
    // Content preserved (not clobbered by a fresh skeleton write).
    expect(readFileSync(projectJson, 'utf8')).toContain('Custom');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeRuntime, runtimeNeedsInit, syncSystemSpaces, hashDir } from './runtime-init.js';

describe('runtime-init', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'lmthing-runtime-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('runtimeNeedsInit is true for a fresh root', () => {
    expect(runtimeNeedsInit(root)).toBe(true);
  });

  it('runtimeNeedsInit stays true for an EMPTY system/spaces/ dir (the repair regression)', () => {
    // A persistent volume can carry an empty system/spaces/ from a prior broken
    // materialization. The guard must NOT treat the bare dir as "initialized" —
    // otherwise the system spaces are never (re)populated and every session
    // fails with `Agent "thing" not found`.
    mkdirSync(join(root, 'system', 'spaces'), { recursive: true });
    expect(runtimeNeedsInit(root)).toBe(true);
  });

  it('materializeRuntime copies system spaces (incl. thing) and the user skeleton', () => {
    const copied = materializeRuntime(root);
    expect(copied).toBeGreaterThan(0);
    expect(existsSync(join(root, 'system', 'spaces', 'user-thing'))).toBe(true);
    expect(existsSync(join(root, 'system', 'spaces', 'user-thing', 'agents'))).toBe(true);
    // The shipped-hash manifest is written so future syncs can detect drift.
    expect(existsSync(join(root, 'system', '.shipped.json'))).toBe(true);
    expect(existsSync(join(root, 'user', 'spaces'))).toBe(true);
    expect(existsSync(join(root, 'user', 'project.json'))).toBe(true);
    // After materialization the guard reports satisfied.
    expect(runtimeNeedsInit(root)).toBe(false);
  });

  it('materializeRuntime repairs an empty system/spaces/ dir', () => {
    mkdirSync(join(root, 'system', 'spaces'), { recursive: true });
    expect(runtimeNeedsInit(root)).toBe(true);
    materializeRuntime(root);
    expect(runtimeNeedsInit(root)).toBe(false);
    expect(existsSync(join(root, 'system', 'spaces', 'user-thing'))).toBe(true);
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

describe('hashDir', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hashdir-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is stable for identical content and changes when content changes', () => {
    writeFileSync(join(dir, 'a.md'), 'hello', 'utf8');
    const h1 = hashDir(dir);
    expect(h1).toBe(hashDir(dir)); // stable
    writeFileSync(join(dir, 'a.md'), 'hello world', 'utf8');
    expect(hashDir(dir)).not.toBe(h1); // content change → different
  });

  it('returns empty string for a missing dir', () => {
    expect(hashDir(join(dir, 'nope'))).toBe('');
  });
});

describe('syncSystemSpaces', () => {
  let root: string;
  const archDir = (r: string) => join(r, 'system', 'spaces', 'system-architect');
  const readManifest = (r: string) => JSON.parse(readFileSync(join(r, 'system', '.shipped.json'), 'utf8')) as Record<string, string>;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sync-')); materializeRuntime(root); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('is a no-op right after materialize (everything up to date)', () => {
    const r = syncSystemSpaces(root);
    expect(r.updated).toEqual([]);
    expect(r.heldBack).toEqual([]);
  });

  it('auto-adopts a PRISTINE space when the recorded hash is stale', () => {
    // Simulate a shipped change: corrupt the recorded hash so it differs from shipped,
    // while the materialized copy still matches that (fake) recorded hash → "pristine".
    const m = readManifest(root);
    // Make the materialized copy match a known marker, and record THAT as the baseline.
    writeFileSync(join(archDir(root), 'MARKER.txt'), 'x', 'utf8');
    m['system-architect'] = hashDir(archDir(root)); // recorded === current (pristine), != shipped
    writeFileSync(join(root, 'system', '.shipped.json'), JSON.stringify(m), 'utf8');
    const r = syncSystemSpaces(root);
    expect(r.updated).toContain('system-architect');
    // Adopting the shipped copy drops the marker (it isn't in the shipped source).
    expect(existsSync(join(archDir(root), 'MARKER.txt'))).toBe(false);
  });

  it('HOLDS BACK a locally-modified space, and adopts it under adopt:true (with backup)', () => {
    const m = readManifest(root);
    m['system-architect'] = 'deadbeef-stale-hash'; // shipped != recorded
    writeFileSync(join(root, 'system', '.shipped.json'), JSON.stringify(m), 'utf8');
    writeFileSync(join(archDir(root), 'MYEDIT.txt'), 'local', 'utf8'); // current != recorded → modified
    const held = syncSystemSpaces(root);
    expect(held.heldBack).toContain('system-architect');
    expect(existsSync(join(archDir(root), 'MYEDIT.txt'))).toBe(true); // preserved

    const adopted = syncSystemSpaces(root, { adopt: true });
    expect(adopted.updated).toContain('system-architect');
    expect(existsSync(join(archDir(root), 'MYEDIT.txt'))).toBe(false); // overwritten by shipped
    // A backup of the modified copy was kept.
    const backups = readdirSync(join(root, 'system', 'spaces')).filter((n) => n.startsWith('system-architect.bak-'));
    expect(backups.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProjectSync,
  scaffoldProjectSync,
  readProjectMeta,
  readProjectHarnessSync,
  setProjectHarness,
} from './projects.js';

/**
 * The per-project harness field: how it is stored, read back, defaulted, and
 * changed. The resolution *rule* is unit-tested in harness.test.ts; this proves
 * the on-disk plumbing carries and normalizes it.
 */
describe('project harness field', () => {
  let root: string;
  const jsonAt = (id: string) => JSON.parse(readFileSync(join(root, id, 'project.json'), 'utf8'));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lmroot-'));
    delete process.env['LMTHING_HARNESS'];
  });
  afterEach(() => {
    delete process.env['LMTHING_HARNESS'];
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('omits harness by default (no per-project preference)', () => {
    createProjectSync(root, 'Plain');
    expect(jsonAt('plain').harness).toBeUndefined();
  });

  it('persists an explicit harness at create time', () => {
    const meta = createProjectSync(root, 'On DSH', 'dsh');
    expect(meta.harness).toBe('dsh');
    expect(jsonAt('on-dsh').harness).toBe('dsh');
  });

  it('readProjectMeta carries a valid harness and drops an invalid one', async () => {
    scaffoldProjectSync(root, 'good', 'Good', 'dsh');
    expect((await readProjectMeta(root, 'good')).harness).toBe('dsh');

    // Hand-corrupt the field: readProjectMeta must not surface it.
    writeFileSync(join(root, 'good', 'project.json'), JSON.stringify({ id: 'good', name: 'Good', harness: 'bogus' }));
    expect((await readProjectMeta(root, 'good')).harness).toBeUndefined();
  });

  it('setProjectHarness preserves other fields and can clear the choice', async () => {
    createProjectSync(root, 'Switch');
    await setProjectHarness(root, 'switch', 'dsh');
    let json = jsonAt('switch');
    expect(json.harness).toBe('dsh');
    expect(json.name).toBe('Switch'); // untouched
    expect(typeof json.createdAt).toBe('number');

    await setProjectHarness(root, 'switch', undefined);
    json = jsonAt('switch');
    expect(json.harness).toBeUndefined();
    expect(json.name).toBe('Switch');
  });

  describe('readProjectHarnessSync (session-build choke point)', () => {
    it('returns the stored value', () => {
      createProjectSync(root, 'Pinned', 'dsh');
      expect(readProjectHarnessSync(root, 'pinned')).toBe('dsh');
    });

    it('falls back to the pod default then lmthing', () => {
      createProjectSync(root, 'Plain');
      expect(readProjectHarnessSync(root, 'plain')).toBe('lmthing');
      process.env['LMTHING_HARNESS'] = 'dsh';
      expect(readProjectHarnessSync(root, 'plain')).toBe('dsh');
    });

    it('never throws for a missing project or bad json', () => {
      expect(readProjectHarnessSync(root, 'does-not-exist')).toBe('lmthing');
      writeFileSync(join(root, 'broken.json'), 'not json');
      expect(readProjectHarnessSync(root, 'broken.json')).toBe('lmthing');
    });
  });
});

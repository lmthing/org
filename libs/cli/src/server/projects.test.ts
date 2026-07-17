import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectSync, uniqueProjectIdSync, scaffoldProjectSync, SYSTEM_PROJECT_ID } from './projects.js';

/**
 * The SYNC live-project scaffold that backs the agent-facing `createProject`
 * global (THING creating a project under `.lmthing/<id>/`) and the REST create
 * path. Proves it lands a real, unique, on-disk project — the persistence the
 * old store-catalog authoring never gave.
 */
describe('createProjectSync (live-project scaffold)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lmroot-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('scaffolds a live project on disk with project.json, instructions, spaces/ and documents/', () => {
    const meta = createProjectSync(root, 'My Todos');
    expect(meta.id).toBe('my-todos');
    expect(meta.name).toBe('My Todos');
    const dir = join(root, 'my-todos');
    expect(existsSync(join(dir, 'project.json'))).toBe(true);
    expect(existsSync(join(dir, 'instructions.md'))).toBe(true);
    expect(existsSync(join(dir, 'spaces'))).toBe(true);
    expect(existsSync(join(dir, 'documents'))).toBe(true);
    const json = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    expect(json).toMatchObject({ id: 'my-todos', name: 'My Todos' });
    expect(typeof json.createdAt).toBe('number');
  });

  it('gives colliding names a unique -N id, never clobbering an existing project', () => {
    const a = createProjectSync(root, 'Trip');
    const b = createProjectSync(root, 'Trip');
    const c = createProjectSync(root, 'Trip');
    expect(a.id).toBe('trip');
    expect(b.id).toBe('trip-1');
    expect(c.id).toBe('trip-2');
    // All three survive on disk.
    for (const id of ['trip', 'trip-1', 'trip-2']) {
      expect(existsSync(join(root, id, 'project.json'))).toBe(true);
    }
  });

  it('never picks the reserved "system" id', () => {
    // A name that slugifies to "system" must be pushed to system-1.
    const meta = createProjectSync(root, 'System');
    expect(meta.id).not.toBe(SYSTEM_PROJECT_ID);
    expect(meta.id).toBe('system-1');
  });

  it('uniqueProjectIdSync avoids an already-scaffolded dir', () => {
    scaffoldProjectSync(root, 'notes', 'Notes');
    expect(uniqueProjectIdSync(root, 'Notes')).toBe('notes-1');
    expect(uniqueProjectIdSync(root, 'Fresh')).toBe('fresh');
  });

  it('rejects an empty / whitespace name', () => {
    expect(() => createProjectSync(root, '   ')).toThrow(/non-empty/);
    expect(() => createProjectSync(root, '')).toThrow(/non-empty/);
  });

  it('does not collide with a pre-existing non-project dir that lacks project.json', () => {
    // uniqueness keys on project.json, so a stray dir without one is still usable.
    mkdirSync(join(root, 'blank'), { recursive: true });
    const meta = createProjectSync(root, 'Blank');
    expect(meta.id).toBe('blank');
    expect(existsSync(join(root, 'blank', 'project.json'))).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProjectSync,
  uniqueProjectIdSync,
  scaffoldProjectSync,
  ensureAppFromBirthSync,
  SYSTEM_PROJECT_ID,
} from './projects.js';
import { writeFileSync } from 'node:fs';

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
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

/**
 * App-from-birth: every scaffolded project is a served app that is a single chat page, and
 * carries its own copy of the `user-thing` space (when the system space is materialized).
 */
describe('scaffoldAppFromBirth', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lmroot-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** Materialize a minimal system user-thing so the per-project copy has a source. */
  function materializeSystemThing(): void {
    const agentDir = join(root, 'system', 'spaces', 'user-thing', 'agents', 'thing');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'instruct.md'), '---\ntitle: THING\n---\nYou are THING.', 'utf8');
    writeFileSync(join(agentDir, 'charter.md'), 'THING charter.', 'utf8');
  }

  it('scaffolds a chat-only served app: views/index.view.json (one chat section) + shell {assistant:false}', () => {
    createProjectSync(root, 'My Todos');
    const dir = join(root, 'my-todos');
    const indexPath = join(dir, 'views', 'index.view.json');
    expect(existsSync(indexPath)).toBe(true);
    const spec = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(spec.route).toBe('index');
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0]).toMatchObject({ kind: 'chat', agent: 'thing', height: 'full' });
    const shell = JSON.parse(readFileSync(join(dir, 'shell.view.json'), 'utf8'));
    expect(shell.assistant).toBe(false);
  });

  it('copies the system user-thing into the project when it is materialized', () => {
    materializeSystemThing();
    createProjectSync(root, 'Trip');
    const projThing = join(root, 'trip', 'spaces', 'user-thing', 'agents', 'thing', 'instruct.md');
    expect(existsSync(projThing)).toBe(true);
    expect(readFileSync(projThing, 'utf8')).toContain('You are THING.');
  });

  it('skips the THING copy gracefully when the system space is not materialized', () => {
    // No materializeSystemThing() — the copy is best-effort and must not throw.
    expect(() => createProjectSync(root, 'Bare')).not.toThrow();
    expect(existsSync(join(root, 'bare', 'spaces', 'user-thing'))).toBe(false);
    // The chat page is still there — the app serves regardless.
    expect(existsSync(join(root, 'bare', 'views', 'index.view.json'))).toBe(true);
  });

  it('ensureAppFromBirthSync adopts an existing legacy project without clobbering real pages', () => {
    materializeSystemThing();
    // A legacy project: has real pages, no chat index, no project THING.
    const dir = join(root, 'legacy');
    mkdirSync(join(dir, 'views'), { recursive: true });
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ id: 'legacy', name: 'Legacy', createdAt: 1 }), 'utf8');
    writeFileSync(join(dir, 'views', 'dashboard.view.json'), JSON.stringify({ route: 'dashboard', sections: [] }), 'utf8');

    ensureAppFromBirthSync(root, 'legacy', 'Legacy');

    // Real page untouched; NO placeholder chat index written (views/ already existed).
    expect(existsSync(join(dir, 'views', 'dashboard.view.json'))).toBe(true);
    expect(existsSync(join(dir, 'views', 'index.view.json'))).toBe(false);
    // But it DID gain a per-project THING copy.
    expect(existsSync(join(dir, 'spaces', 'user-thing', 'agents', 'thing', 'instruct.md'))).toBe(true);
  });

  it('ensureAppFromBirthSync is idempotent on a fully-scaffolded project', () => {
    materializeSystemThing();
    createProjectSync(root, 'Fresh');
    const before = readFileSync(join(root, 'fresh', 'views', 'index.view.json'), 'utf8');
    expect(() => ensureAppFromBirthSync(root, 'fresh', 'Fresh')).not.toThrow();
    const after = readFileSync(join(root, 'fresh', 'views', 'index.view.json'), 'utf8');
    expect(after).toBe(before);
  });
});

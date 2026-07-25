/**
 * Project-app db backup wiring (Phase 2 §backup — two edits):
 *   1. the live binary `.data/app.db` (+ WAL/SHM sidecars) is never tracked;
 *   2. `runBackup` regenerates `<project>/.data/app.sql` from every project db
 *      right before staging, so the committed dump always reflects live rows.
 *
 * Fully offline: a `file://` bare repo is the remote (via LM_BACKUP_TEST_REMOTE).
 * The project db is seeded through the real store (`openProjectDb`), so the dump
 * format under test is the production one.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runBackup, dumpAllProjectDbs } from './backup.js';

const execFileAsync = promisify(execFile);

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

async function makeBareRemote(): Promise<string> {
  const bare = await tmp('lm-bare-');
  await execFileAsync('git', ['init', '--bare', '-b', 'lmthing-backup'], { cwd: bare });
  return `file://${bare}`;
}

/**
 * Scaffold a real project with a project.json and a seeded `.data/app.db`.
 * Seeded through raw better-sqlite3 (a plain on-disk sqlite file) so this test
 * couples only to the store's guaranteed open+dump contract, not 2A's
 * schema-authoring API. `insertRows` lets a second row set be added on re-dump.
 */
async function seedProjectWithDb(
  root: string,
  id: string,
  rows: Array<{ id: string; title: string }> = [
    { id: 'a1', title: 'ALPHA_ROW' },
    { id: 'b2', title: 'BRAVO_ROW' },
  ],
): Promise<void> {
  await mkdir(join(root, id, '.data'), { recursive: true });
  await writeFile(join(root, id, 'project.json'), JSON.stringify({ id, name: id, createdAt: 1 }));
  insertRows(join(root, id, '.data', 'app.db'), rows, true);
}

function insertRows(
  dbPath: string,
  rows: Array<{ id: string; title: string }>,
  createTable: boolean,
): void {
  const db = new Database(dbPath);
  try {
    if (createTable) {
      db.exec('CREATE TABLE IF NOT EXISTS feed_items (id TEXT PRIMARY KEY, title TEXT)');
    }
    const stmt = db.prepare('INSERT INTO feed_items (id, title) VALUES (?, ?)');
    for (const r of rows) stmt.run(r.id, r.title);
  } finally {
    db.close();
  }
}

/** A project directory with no app db (must be skipped without error). */
async function seedProjectNoDb(root: string, id: string): Promise<void> {
  await mkdir(join(root, id), { recursive: true });
  await writeFile(join(root, id, 'project.json'), JSON.stringify({ id, name: id, createdAt: 2 }));
  await writeFile(join(root, id, 'instructions.md'), '# no db here');
}

beforeEach(() => {
  process.env.GITHUB_BACKUP_BRANCH = 'lmthing-backup';
  delete process.env.LMTHING_BACKUP_JWT;
});

describe('dumpAllProjectDbs', () => {
  it('regenerates app.sql (with rows) for a project with a db, and skips one without', async () => {
    const root = await tmp('lm-dump-');
    await seedProjectWithDb(root, 'user');
    await seedProjectNoDb(root, 'empty');

    await dumpAllProjectDbs(root);

    const sqlPath = join(root, 'user', '.data', 'app.sql');
    expect(existsSync(sqlPath)).toBe(true);
    const sql = await readFile(sqlPath, 'utf8');
    expect(sql).toContain('feed_items');
    expect(sql).toContain('ALPHA_ROW');
    expect(sql).toContain('BRAVO_ROW');

    // The project without a db is untouched — no app.sql conjured.
    expect(existsSync(join(root, 'empty', '.data', 'app.sql'))).toBe(false);
  });

  it('reflects fresh rows on re-dump', async () => {
    const root = await tmp('lm-dump2-');
    await seedProjectWithDb(root, 'user');
    await dumpAllProjectDbs(root);

    insertRows(join(root, 'user', '.data', 'app.db'), [{ id: 'c3', title: 'CHARLIE_ROW' }], false);

    await dumpAllProjectDbs(root);
    const sql = await readFile(join(root, 'user', '.data', 'app.sql'), 'utf8');
    expect(sql).toContain('CHARLIE_ROW');
  });

  it('does not throw when the root has no projects', async () => {
    const root = await tmp('lm-dump3-');
    await expect(dumpAllProjectDbs(root)).resolves.toBeUndefined();
  });
});

describe('runBackup — project db dump + binary exclusion', () => {
  it('commits app.sql but never the binary app.db / WAL sidecars', async () => {
    const root = await tmp('lm-work-');
    const remote = await makeBareRemote();
    process.env.LM_BACKUP_TEST_REMOTE = remote;
    await seedProjectWithDb(root, 'user');
    // A stray WAL sidecar on disk must also stay untracked.
    await writeFile(join(root, 'user', '.data', 'app.db-wal'), 'WAL_JUNK');
    await writeFile(join(root, 'user', '.data', 'hooks-state.json'), '{"lastRun":0}');

    const res = await runBackup({ trigger: 'manual', workTree: root });
    expect(res.ok).toBe(true);
    expect(res.committed).toBe(true);

    // Inspect the pushed tree via a fresh clone.
    const clone = await tmp('lm-clone-');
    await execFileAsync('git', ['clone', '--branch', 'lmthing-backup', remote, clone]);
    const tracked = (await git(clone, 'ls-files')).split('\n').filter(Boolean);

    // The dump + tracked sidecar are committed…
    expect(tracked).toContain('user/.data/app.sql');
    expect(tracked).toContain('user/.data/hooks-state.json');
    // …the binary db and its WAL sidecar are NOT.
    expect(tracked.some((f) => f.endsWith('.data/app.db'))).toBe(false);
    expect(tracked.some((f) => f.includes('app.db-wal'))).toBe(false);

    // The committed dump carries the live rows.
    const sql = await readFile(join(clone, 'user', '.data', 'app.sql'), 'utf8');
    expect(sql).toContain('ALPHA_ROW');
    expect(sql).toContain('BRAVO_ROW');
  });
});

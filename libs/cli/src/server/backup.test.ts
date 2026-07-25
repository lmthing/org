/**
 * Pod-side workspace backup/restore — offline, deterministic git test.
 *
 * Uses a `file://` bare repo as the remote (via LM_BACKUP_TEST_REMOTE) so there
 * is no network or GitHub token involved. Proves the important guarantees:
 *   - user files are backed up; secrets / sessions / conversations / node_modules
 *     are NEVER tracked (the secret string appears nowhere in the clone);
 *   - no-op runs don't create empty commits; edits do;
 *   - concurrent backups are serialised (no corruption, exactly one commit);
 *   - restore overwrites tracked files, recreates deleted ones, and never
 *     touches excluded paths or local-only files;
 *   - credential scrubbing removes embedded tokens from error text.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBackup, runRestore, readBackupStatus, scrub } from './backup.js';

const execFileAsync = promisify(execFile);
const SECRET = 'super-secret-azure-key-DO-NOT-LEAK';

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

/** A workspace with real user content plus everything that must be excluded. */
async function seedWorkspace(root: string): Promise<void> {
  await mkdir(join(root, 'user', 'spaces', 'foo', 'agents'), { recursive: true });
  await writeFile(join(root, 'user', 'project.json'), '{"id":"user"}');
  await writeFile(join(root, 'user', 'instructions.md'), '# hello');
  await writeFile(join(root, 'user', 'spaces', 'foo', 'agents', 'thing.md'), 'agent');
  // Must be excluded:
  await writeFile(join(root, '.env'), `AZURE_API_KEY=${SECRET}\n`);
  await mkdir(join(root, 'user', 'sessions', 's1'), { recursive: true });
  await writeFile(join(root, 'user', 'sessions', 's1', 'snapshot.json'), `{"k":"${SECRET}"}`);
  await mkdir(join(root, 'user', 'spaces', 'foo', 'conversations'), { recursive: true });
  await writeFile(join(root, 'user', 'spaces', 'foo', 'conversations', 'c.json'), '[]');
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'x');
}

async function makeBareRemote(): Promise<string> {
  const bare = await tmp('lm-bare-');
  await git(bare, 'init', '--bare', '-b', 'lmthing-backup');
  return `file://${bare}`;
}

async function cloneAndList(remoteUrl: string): Promise<{ dir: string; files: string[] }> {
  const dir = await tmp('lm-clone-');
  await execFileAsync('git', ['clone', '--branch', 'lmthing-backup', remoteUrl, dir]);
  const out = await git(dir, 'ls-files');
  return { dir, files: out.split('\n').filter(Boolean) };
}

beforeEach(() => {
  process.env.GITHUB_BACKUP_BRANCH = 'lmthing-backup';
  delete process.env.LMTHING_BACKUP_JWT;
});

describe('runBackup', () => {
  it('backs up user files and never tracks secrets/sessions/conversations/node_modules', async () => {
    const root = await tmp('lm-work-');
    const remote = await makeBareRemote();
    process.env.LM_BACKUP_TEST_REMOTE = remote;
    await seedWorkspace(root);

    const res = await runBackup({ trigger: 'manual', workTree: root });
    expect(res.ok).toBe(true);
    expect(res.committed).toBe(true);
    expect(res.sha).toMatch(/^[0-9a-f]{7,}$/);

    const { dir, files } = await cloneAndList(remote);
    expect(files).toContain('user/project.json');
    expect(files).toContain('user/instructions.md');
    expect(files).toContain('user/spaces/foo/agents/thing.md');
    // Excluded:
    expect(files).not.toContain('.env');
    expect(files.some((f) => f.includes('sessions/'))).toBe(false);
    expect(files.some((f) => f.includes('conversations/'))).toBe(false);
    expect(files.some((f) => f.includes('node_modules/'))).toBe(false);

    // The secret must appear nowhere in the backed-up content.
    for (const f of files) {
      const content = await readFile(join(dir, f), 'utf8');
      expect(content).not.toContain(SECRET);
    }

    const status = await readBackupStatus(root);
    expect(status.status).toBe('ok');
    expect(status.lastCommitSha).toBe(res.sha);
  });

  it('does not commit when there are no changes, but does after an edit', async () => {
    const root = await tmp('lm-work-');
    process.env.LM_BACKUP_TEST_REMOTE = await makeBareRemote();
    await seedWorkspace(root);

    expect((await runBackup({ trigger: 'manual', workTree: root })).committed).toBe(true);
    expect((await runBackup({ trigger: 'auto', workTree: root })).committed).toBe(false);

    await writeFile(join(root, 'user', 'instructions.md'), '# changed');
    expect((await runBackup({ trigger: 'manual', workTree: root })).committed).toBe(true);
  });

  it('serialises concurrent backups (mutex) — exactly one commit for one change set', async () => {
    const root = await tmp('lm-work-');
    const remote = await makeBareRemote();
    process.env.LM_BACKUP_TEST_REMOTE = remote;
    await seedWorkspace(root);

    const [a, b] = await Promise.all([
      runBackup({ trigger: 'manual', workTree: root }),
      runBackup({ trigger: 'auto', workTree: root }),
    ]);
    // One does the initial commit, the other sees a clean tree.
    expect([a.committed, b.committed].filter(Boolean).length).toBe(1);

    const { dir } = await cloneAndList(remote);
    const log = (await git(dir, 'rev-list', '--count', 'HEAD')).trim();
    expect(log).toBe('1');
  });

  it('returns not-configured when no remote/token is available', async () => {
    const root = await tmp('lm-work-');
    delete process.env.LM_BACKUP_TEST_REMOTE;
    delete process.env.LMTHING_BACKUP_JWT;
    await seedWorkspace(root);
    const res = await runBackup({ trigger: 'manual', workTree: root });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-configured');
  });
});

describe('runRestore', () => {
  it('overwrites tracked files, recreates deletions, and leaves secrets/local-only files intact', async () => {
    const root = await tmp('lm-work-');
    process.env.LM_BACKUP_TEST_REMOTE = await makeBareRemote();
    await seedWorkspace(root);
    await runBackup({ trigger: 'manual', workTree: root });

    // Mutate the local workspace after backup.
    await writeFile(join(root, 'user', 'instructions.md'), '# LOCALLY CHANGED');
    await rm(join(root, 'user', 'project.json'));
    await writeFile(join(root, 'user', 'local-only.txt'), 'keep me');

    const res = await runRestore({ workTree: root });
    expect(res.ok).toBe(true);
    expect(res.restored).toBeGreaterThan(0);
    expect(res.branch).toBe('lmthing-backup');

    // Tracked file overwritten back to backup content; deleted file recreated.
    expect(await readFile(join(root, 'user', 'instructions.md'), 'utf8')).toBe('# hello');
    expect(existsSync(join(root, 'user', 'project.json'))).toBe(true);
    // Local-only file preserved.
    expect(await readFile(join(root, 'user', 'local-only.txt'), 'utf8')).toBe('keep me');
    // Excluded secret never clobbered.
    expect(await readFile(join(root, '.env'), 'utf8')).toContain(SECRET);
  });

  it('reports no-backup when the branch does not exist yet', async () => {
    const root = await tmp('lm-work-');
    process.env.LM_BACKUP_TEST_REMOTE = await makeBareRemote();
    await seedWorkspace(root);
    const res = await runRestore({ workTree: root });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-backup');
  });
});

describe('scrub', () => {
  it('removes an embedded x-access-token credential and the raw token', async () => {
    const token = 'ghs_ABC123secret';
    const msg = `fatal: unable to access 'https://x-access-token:${token}@github.com/o/r.git/'`;
    const cleaned = scrub(msg, token);
    expect(cleaned).not.toContain(token);
    expect(cleaned).toContain('x-access-token:***@');
  });
});

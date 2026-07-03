import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { listProjects } from './projects.js';
import { openProjectDb } from '../app/store.js';

const execFileAsync = promisify(execFile);

/**
 * Pod-side GitHub backup/restore of the workspace at `<workTree>` (in
 * production, `/data/.lmthing` on the user's PVC).
 *
 * Design notes:
 * - The `.git` dir lives OUTSIDE the work-tree (`<workTree>.git`) so nothing
 *   git-related is ever committed or restored, and there's no self-nesting.
 * - Exclusions (secrets, sessions, node_modules) go in `$GIT_DIR/info/exclude`,
 *   never a committed `.gitignore`, so secrets are never even tracked.
 * - We never persist a GitHub token: for each push/pull the pod asks the gateway
 *   (`POST /api/backup/token`, authed with the injected LMTHING_BACKUP_JWT) for a
 *   short-lived, repo-scoped installation token, and passes it only through an
 *   env-reading git credential helper — never to disk config or argv.
 * - All git calls are async `execFile` (never `execSync`) so a slow network op
 *   can't block the session server's event loop / trip the idle watchdog.
 */

const GATEWAY_URL =
  process.env.LMTHING_GATEWAY_URL || 'http://gateway.lmthing.svc.cluster.local:3000';

const DEFAULT_BRANCH = 'lmthing-backup';

// Paths that must never be backed up. Generalises isExcludedSpaceRelPath +
// the fs.ts excluded dirs to the whole workspace tree. `.env*` is the critical
// secret-leak vector; sessions/conversations are churny and large.
const EXCLUDE_PATTERNS = [
  '.env',
  '.env.*',
  '**/sessions/',
  '**/conversations/',
  'node_modules/',
  '.cache/',
  // The live binary project-app db is DR state, never tracked; its regenerated
  // `.data/app.sql` dump (see dumpAllProjectDbs) is the committed, restorable
  // form. `app.db-*` catches the WAL/SHM sidecars (`app.db-wal`, `app.db-shm`).
  '**/.data/app.db',
  '**/.data/app.db-*',
];

export interface BackupResult {
  ok: boolean;
  reason?: string;
  committed?: boolean;
  sha?: string;
}

export interface RestoreResult {
  ok: boolean;
  reason?: string;
  restored?: number;
  branch?: string;
  commitSha?: string;
}

export interface BackupStatus {
  status: 'ok' | 'error' | 'idle';
  lastBackupAt: string | null;
  lastCheckedAt: string | null;
  lastCommitSha: string | null;
  error: string | null;
}

// ─── token / stderr scrubbing ───────────────────────────────────────────────

/** Strip any embedded credential from text before it is logged or surfaced. */
export function scrub(text: string, token?: string): string {
  let out = text.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
  if (token) out = out.split(token).join('***');
  return out;
}

// ─── serialization ──────────────────────────────────────────────────────────

// A promise chain serialises all backup/restore ops so a manual "Back up now"
// and the auto timer (and the SIGTERM flush) can never corrupt the repo by
// running git concurrently.
let lockTail: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = lockTail.then(fn, fn);
  lockTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// ─── git helpers ────────────────────────────────────────────────────────────

function gitDirFor(workTree: string): string {
  return join(dirname(workTree), basename(workTree) + '.git');
}

function statusFileFor(workTree: string): string {
  return join(gitDirFor(workTree), 'last-backup.json');
}

async function git(
  workTree: string,
  args: string[],
  opts: { token?: string; allowFail?: boolean } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const gitDir = gitDirFor(workTree);
  const env = { ...process.env };
  const pre: string[] = ['--git-dir', gitDir, '--work-tree', workTree];
  // When a token is supplied, wire an env-reading credential helper so the
  // secret only ever exists in the child env, not in argv or on-disk config.
  if (opts.token) {
    env.GH_TMP_TOKEN = opts.token;
    const helper = '!f() { echo username=x-access-token; echo "password=${GH_TMP_TOKEN}"; }; f';
    // First `-c credential.helper=` clears any inherited/system helpers.
    pre.push('-c', 'credential.helper=', '-c', `credential.helper=${helper}`);
  }
  try {
    const { stdout, stderr } = await execFileAsync('git', [...pre, ...args], {
      cwd: workTree,
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    if (opts.allowFail) {
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
    }
    const detail = scrub(e.stderr || e.message || 'git failed', opts.token);
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
}

// ─── remote resolution ──────────────────────────────────────────────────────

interface RemoteConfig {
  cloneUrl: string;
  branch: string;
  /** null for an unauthenticated (test file://) remote. */
  token: string | null;
}

/**
 * Resolve where to push/pull. In production this fetches a short-lived
 * installation token (and the target repo/branch) from the gateway. Tests set
 * LM_BACKUP_TEST_REMOTE to a `file://` bare repo to run fully offline.
 */
async function resolveRemote(): Promise<RemoteConfig> {
  const testRemote = process.env.LM_BACKUP_TEST_REMOTE;
  if (testRemote) {
    return {
      cloneUrl: testRemote,
      branch: process.env.GITHUB_BACKUP_BRANCH || DEFAULT_BRANCH,
      token: null,
    };
  }

  const jwt = process.env.LMTHING_BACKUP_JWT;
  if (!jwt) throw new Error('backup not configured');

  const r = await fetch(`${GATEWAY_URL}/api/backup/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`could not obtain backup token: ${r.status} ${body}`);
  }
  const data = (await r.json()) as { token: string; repo: string; branch?: string };
  return {
    cloneUrl: `https://github.com/${data.repo}.git`,
    branch: data.branch || DEFAULT_BRANCH,
    token: data.token,
  };
}

// ─── repo setup ─────────────────────────────────────────────────────────────

function isConfigured(): boolean {
  return Boolean(process.env.LMTHING_BACKUP_JWT || process.env.LM_BACKUP_TEST_REMOTE);
}

async function ensureRepo(workTree: string): Promise<void> {
  const gitDir = gitDirFor(workTree);
  await mkdir(workTree, { recursive: true });
  if (!existsSync(join(gitDir, 'HEAD'))) {
    await git(workTree, ['init', '-b', DEFAULT_BRANCH]);
    await git(workTree, ['config', 'user.name', 'lmthing-backup']);
    await git(workTree, ['config', 'user.email', 'backup@lmthing.cloud']);
  }
  // Always (re)write the exclude list so a repo created before a rule change
  // still honours it. info/exclude behaves like .gitignore but is never tracked.
  await mkdir(join(gitDir, 'info'), { recursive: true });
  await writeFile(join(gitDir, 'info', 'exclude'), EXCLUDE_PATTERNS.join('\n') + '\n', 'utf8');
  // Belt-and-suspenders: if a secret was tracked by an older repo, untrack it
  // (leaves the working file in place). Ignore failure when nothing matches.
  await git(workTree, ['rm', '-r', '--cached', '--ignore-unmatch', '.env', '.env.*'], {
    allowFail: true,
  });
}

async function setRemote(workTree: string, cloneUrl: string): Promise<void> {
  const res = await git(workTree, ['remote'], { allowFail: true });
  const remotes = res.stdout.split('\n').map((s) => s.trim());
  if (remotes.includes('origin')) {
    await git(workTree, ['remote', 'set-url', 'origin', cloneUrl]);
  } else {
    await git(workTree, ['remote', 'add', 'origin', cloneUrl]);
  }
}

// ─── status file ────────────────────────────────────────────────────────────

async function writeStatus(workTree: string, status: BackupStatus): Promise<void> {
  try {
    await mkdir(gitDirFor(workTree), { recursive: true });
    await writeFile(statusFileFor(workTree), JSON.stringify(status, null, 2), 'utf8');
  } catch {
    /* status is best-effort */
  }
}

export async function readBackupStatus(workTree: string): Promise<BackupStatus> {
  try {
    const raw = await readFile(statusFileFor(workTree), 'utf8');
    return JSON.parse(raw) as BackupStatus;
  } catch {
    return {
      status: 'idle',
      lastBackupAt: null,
      lastCheckedAt: null,
      lastCommitSha: null,
      error: null,
    };
  }
}

// ─── push (fast-forward, else force-with-lease on a pod-owned branch) ────────

async function pushBranch(
  workTree: string,
  remote: RemoteConfig,
): Promise<void> {
  const refspec = `HEAD:refs/heads/${remote.branch}`;
  const first = await git(workTree, ['push', 'origin', refspec], {
    token: remote.token ?? undefined,
    allowFail: true,
  });
  if (first.code === 0) return;
  // Non-fast-forward (e.g. the branch diverged): the pod is authoritative for
  // this dedicated backup branch, so reconcile and force-with-lease.
  await git(workTree, ['fetch', 'origin', remote.branch], {
    token: remote.token ?? undefined,
    allowFail: true,
  });
  const forced = await git(
    workTree,
    ['push', '--force-with-lease', 'origin', refspec],
    { token: remote.token ?? undefined, allowFail: true },
  );
  if (forced.code !== 0) {
    throw new Error(`git push failed: ${scrub(forced.stderr, remote.token ?? undefined)}`);
  }
}

// ─── project-app db dumps ────────────────────────────────────────────────────

/**
 * Regenerate `<root>/<id>/.data/app.sql` for every project that has a live
 * binary db at `<root>/<id>/.data/app.db`. The binary db is DR-only and never
 * committed (see EXCLUDE_PATTERNS); the `.sql` dump is the tracked, restorable
 * form (`hooks-state.json` alongside it stays tracked too). Runs immediately
 * before the git staging step in {@link runBackup}.
 *
 * Each project is dumped independently and defensively: a single unreadable /
 * corrupt db logs and is skipped so it can't abort the whole backup. The
 * synthetic `system` project has no app db, so the existence check skips it.
 */
export async function dumpAllProjectDbs(root: string): Promise<void> {
  let projects: { id: string }[];
  try {
    projects = await listProjects(root);
  } catch (err) {
    console.warn(
      '[backup] could not enumerate projects for db dump:',
      err instanceof Error ? err.message : err,
    );
    return;
  }
  for (const { id } of projects) {
    const dataDir = join(root, id, '.data');
    const dbPath = join(dataDir, 'app.db');
    if (!existsSync(dbPath)) continue; // no app db (e.g. the synthetic system project)
    try {
      const db = openProjectDb(dbPath, { create: false });
      try {
        await writeFile(join(dataDir, 'app.sql'), db.dumpToSql(), 'utf8');
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn(
        `[backup] db dump failed for project ${id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ─── public: backup ─────────────────────────────────────────────────────────

export async function runBackup(opts: {
  trigger: 'manual' | 'auto' | 'shutdown';
  workTree: string;
}): Promise<BackupResult> {
  const { workTree } = opts;
  if (!isConfigured()) return { ok: false, reason: 'not-configured' };

  return withLock(async () => {
    let remote: RemoteConfig;
    try {
      remote = await resolveRemote();
      await ensureRepo(workTree);
      await setRemote(workTree, remote.cloneUrl);
      // Pre-dump: regenerate each project's `.data/app.sql` from its live db so
      // the tracked dump reflects current rows (the binary db itself is excluded).
      await dumpAllProjectDbs(workTree);
      await git(workTree, ['add', '-A']);

      const dirty = (await git(workTree, ['status', '--porcelain'])).stdout.trim();
      const now = new Date().toISOString();
      if (!dirty) {
        const prev = await readBackupStatus(workTree);
        await writeStatus(workTree, { ...prev, status: prev.status === 'error' ? 'idle' : prev.status, lastCheckedAt: now, error: null });
        return { ok: true, committed: false };
      }

      await git(workTree, ['commit', '-m', `backup: ${now} (${opts.trigger})`]);
      const sha = (await git(workTree, ['rev-parse', 'HEAD'])).stdout.trim();
      await pushBranch(workTree, remote);

      await writeStatus(workTree, {
        status: 'ok',
        lastBackupAt: now,
        lastCheckedAt: now,
        lastCommitSha: sha,
        error: null,
      });
      return { ok: true, committed: true, sha };
    } catch (err) {
      const msg = scrub(err instanceof Error ? err.message : String(err));
      const prev = await readBackupStatus(workTree);
      await writeStatus(workTree, {
        ...prev,
        status: 'error',
        lastCheckedAt: new Date().toISOString(),
        error: msg,
      });
      throw new Error(msg);
    }
  });
}

// ─── public: restore ────────────────────────────────────────────────────────

/**
 * Pull the backup branch and overwrite tracked files in the work-tree.
 * Non-destructive: files present in the backup overwrite local copies and
 * missing ones are recreated, but local-only files are left in place and
 * excluded paths (.env*, sessions/, conversations/) are never touched (they
 * were never committed, so they're absent from the backup tree).
 */
export async function runRestore(opts: { workTree: string }): Promise<RestoreResult> {
  const { workTree } = opts;
  if (!isConfigured()) return { ok: false, reason: 'not-configured' };

  return withLock(async () => {
    const remote = await resolveRemote();
    await ensureRepo(workTree);
    await setRemote(workTree, remote.cloneUrl);

    const fetched = await git(workTree, ['fetch', 'origin', remote.branch], {
      token: remote.token ?? undefined,
      allowFail: true,
    });
    if (fetched.code !== 0) {
      // No such branch yet → nothing has been backed up.
      return { ok: false, reason: 'no-backup', branch: remote.branch };
    }

    const commitSha = (await git(workTree, ['rev-parse', 'FETCH_HEAD'])).stdout.trim();
    // Overwrite working-tree + index with every path in the backup commit.
    await git(workTree, ['checkout', 'FETCH_HEAD', '--', '.']);
    const listed = (await git(workTree, ['ls-tree', '-r', '--name-only', 'FETCH_HEAD'])).stdout
      .split('\n')
      .filter((l) => l.trim().length > 0);

    return { ok: true, restored: listed.length, branch: remote.branch, commitSha };
  });
}

// ─── public: auto timer ─────────────────────────────────────────────────────

/**
 * When GITHUB_BACKUP_AUTO is enabled, run a backup every
 * GITHUB_BACKUP_INTERVAL_MIN minutes. The env is fixed at pod start; saving new
 * config in the UI restarts the pod, so these values are always current.
 * Returns the interval handle (unref'd) or null when auto is off.
 */
export function startBackupTimer(workTree: string): NodeJS.Timeout | null {
  if (process.env.GITHUB_BACKUP_AUTO !== '1') return null;
  const min = parseInt(process.env.GITHUB_BACKUP_INTERVAL_MIN || '60', 10);
  const ms = Math.max(5, Number.isFinite(min) ? min : 60) * 60_000;
  const timer = setInterval(() => {
    void runBackup({ trigger: 'auto', workTree }).catch((err) => {
      console.warn('[backup] auto backup failed:', err instanceof Error ? err.message : err);
    });
  }, ms);
  timer.unref();
  console.log(`[backup] auto backup enabled: every ${ms / 60000} min`);
  return timer;
}

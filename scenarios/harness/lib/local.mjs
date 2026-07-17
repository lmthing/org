/**
 * Per-run local server lifecycle — every scenario RUN gets its OWN throwaway `lmthing serve`, rooted
 * at its OWN data dir, on its OWN port. This replaces the old single shared, port-keyed server.
 *
 * WHY per-run: a run's `.lmthing` root is fixed by the server's cwd, so a unique data dir per run
 * requires a server per run. Full isolation lets each run keep a clean, uniquely-numbered directory
 * (`<scenario>/runs/<n>/data/.lmthing`) AND snapshot its project files at each step so a rerun can
 * seed from a snapshot and continue — without a shared root that lanes trip over.
 *
 * WHERE it lives: `<scenarioDir>/runs/<runId>/` (never /tmp, never `.state`) —
 *   data/.lmthing/<project>/…   the run's project data (cwd = runs/<n>/data)
 *   data/store-apps/            the app catalog (LM_STORE_APPS_DIR)
 *   snapshots/step-NN/          per-step project-file snapshots (for --resume)
 *   sessions.log                the run's `lmthing serve` stdout+stderr
 *   run.json                    { runId, scenarioId, projectId, port, base, serverPid, … }
 *   runner.pid                  the run-scenario process (written by runner.mjs)
 *
 * HOW it launches: `pnpm lmthing serve --cwd <data> --port <port> --env-file <sdk/org>/.env
 * --adopt-system-spaces --max-sessions 40` — spawned FROM `sdk/org` so pnpm resolves the `lmthing`
 * script (runs the CLI from TS source via tsx → NO build needed), then `applyCwd` chdirs the process
 * into `<data>` so `.lmthing` and `--env-file` resolve correctly.
 *
 * TEARDOWN is unconditional on kill: the server is DETACHED (own process group), and `stopRun`
 * SIGKILLs the whole group + kills whatever still holds the port. The runner installs signal handlers
 * so that when run-scenario is killed (SIGINT/SIGTERM/SIGHUP/…) the server is ALWAYS killed too. A
 * startup orphan-reaper cleans any server left behind by an untrappable SIGKILL of a prior runner.
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  cpSync,
  symlinkSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SDK_ORG, STATE_DIR } from './paths.mjs';

/** True when the harness targets a local `lmthing serve` rather than a provisioned prod pod. */
export const LOCAL =
  process.env.SCENARIO_TARGET === 'local' || /localhost|127\.0\.0\.1/.test(process.env.LM_POD_BASE ?? '');

const BIN_ARGS = ['lmthing', 'serve']; // `pnpm lmthing serve …` — tsx-from-source, no build
const ENV_FILE = join(SDK_ORG, '.env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// ── readiness ────────────────────────────────────────────────────────────────
/** Does the server answer at all? `GET /api/projects` needs no body/auth and is cheap. */
export async function serverUp(base, { timeoutMs = 1500 } = {}) {
  try {
    const res = await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status > 0; // any HTTP answer means it's listening
  } catch {
    return false;
  }
}

async function waitUp(base, { attempts = 120, everyMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await serverUp(base)) return true;
    await sleep(everyMs);
  }
  return false;
}

// ── pid / port helpers ─────────────────────────────────────────────────────────
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

/** Every PID currently LISTENING on `port` (the whole `pnpm→tsx→node` tree's listener). */
function pidsOnPort(port) {
  try {
    const out = execSync(`ss -ltnpH 'sport = :${port}'`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]));
  } catch {
    return [];
  }
}

/** Kill whatever is listening on `port` (SIGKILL — this is teardown, not graceful shutdown). */
function killPort(port) {
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

// ── free-port allocation ────────────────────────────────────────────────────────
/** Ask the OS for an unused TCP port (bind to 0, read it back, release it). */
export function allocatePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

// ── run directory layout ────────────────────────────────────────────────────────
/** `<scenarioDir>/runs`. */
export function runsDir(scenarioDir) {
  return join(scenarioDir, 'runs');
}

/** Absolute dir of one run. */
export function runDir(scenarioDir, runId) {
  return join(runsDir(scenarioDir), String(runId));
}

/** Next free integer run id for a scenario (max existing numeric dir + 1). */
export function nextRunId(scenarioDir) {
  let max = 0;
  for (const e of readdirSyncSafe(runsDir(scenarioDir))) {
    if (/^\d+$/.test(e)) max = Math.max(max, Number(e));
  }
  return max + 1;
}

/** The `snapshots/step-NN` dir of a run. */
export function snapshotDir(scenarioDir, runId, stepNum) {
  return join(runDir(scenarioDir, runId), 'snapshots', `step-${String(stepNum).padStart(2, '0')}`);
}

/** Parsed `run.json` of a prior run (throws if absent). */
export function readRunJson(scenarioDir, runId) {
  return JSON.parse(readFileSync(join(runDir(scenarioDir, runId), 'run.json'), 'utf8'));
}

function writeRunJson(run, patch = {}) {
  const path = join(run.dir, 'run.json');
  let cur = {};
  try {
    cur = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    /* first write */
  }
  const next = {
    runId: run.runId,
    scenarioId: run.scenarioId,
    projectId: run.projectId,
    port: run.port,
    base: run.base,
    serverPid: run.serverPid ?? null,
    createdAt: cur.createdAt ?? Date.now(),
    completedSteps: 0,
    ...cur,
    ...patch,
  };
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}

/** Record how many steps have been completed (so a bare `--resume <id>` knows where to continue). */
export function bumpCompletedSteps(run, stepCount, extra = {}) {
  writeRunJson(run, { completedSteps: stepCount, ...extra });
}

function updateLatest(scenarioDir, runId) {
  const link = join(runsDir(scenarioDir), 'latest');
  try {
    rmSync(link, { force: true });
    symlinkSync(String(runId), link, 'dir');
  } catch {
    // Filesystems without symlink support: leave a plain pointer file instead.
    try {
      writeFileSync(link + '.txt', String(runId));
    } catch {
      /* best-effort convenience only */
    }
  }
}

/** Every run of a scenario, with liveness, newest first. */
export function listRuns(scenarioDir) {
  const dir = runsDir(scenarioDir);
  return readdirSyncSafe(dir)
    .filter((e) => /^\d+$/.test(e))
    .map((e) => {
      const d = join(dir, e);
      let meta = {};
      try {
        meta = JSON.parse(readFileSync(join(d, 'run.json'), 'utf8'));
      } catch {
        /* partial run */
      }
      return { runId: Number(e), dir: d, alive: pidAlive(meta.serverPid), ...meta };
    })
    .sort((a, b) => b.runId - a.runId);
}

// ── snapshot / seed ────────────────────────────────────────────────────────────
// `.lmthing/system` is re-materialized on every boot via `--adopt-system-spaces`, so it is never
// snapshotted or restored — only the run's actual project data (+ the app catalog) is.
function copyLmthingSansSystem(srcLm, dstLm) {
  cpSync(srcLm, dstLm, {
    recursive: true,
    filter: (s) => {
      const rel = relative(srcLm, s);
      return !(rel === 'system' || rel.startsWith('system' + sep));
    },
  });
}

/**
 * Snapshot the run's project files (its `.lmthing` minus `system`, plus the `store-apps` catalog)
 * into `snapshots/step-NN/`. Includes `.data/app.db` (+ WAL/SHM) and `<project>/sessions/` so a
 * reseeded server sees all built state AND can resume the persisted THING session. Taken at step end
 * when the server is idle, so the copy is consistent. Returns the snapshot dir.
 */
export function snapshotProject(run, stepNum) {
  const dst = snapshotDir(run.scenarioDir, run.runId, stepNum);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  const srcLm = join(run.dataDir, '.lmthing');
  if (existsSync(srcLm)) copyLmthingSansSystem(srcLm, join(dst, '.lmthing'));
  const srcApps = join(run.dataDir, 'store-apps');
  if (existsSync(srcApps)) cpSync(srcApps, join(dst, 'store-apps'), { recursive: true });
  return dst;
}

/** Restore a snapshot into a run's (empty) data dir BEFORE the server boots. */
export function seedRun(run, fromSnapshotDir) {
  const srcLm = join(fromSnapshotDir, '.lmthing');
  if (existsSync(srcLm)) copyLmthingSansSystem(srcLm, join(run.dataDir, '.lmthing'));
  const srcApps = join(fromSnapshotDir, 'store-apps');
  if (existsSync(srcApps)) cpSync(srcApps, join(run.dataDir, 'store-apps'), { recursive: true });
}

/**
 * The newest persisted THING session id for a project (a project session lives under
 * `<data>/.lmthing/<projectId>/sessions/<id>/`). Used on --resume so the reseeded server can
 * `resumeSessionId` the conversation the snapshot captured, not just its files. Null if none.
 */
export function latestSessionId(run, projectId) {
  const dir = join(run.dataDir, '.lmthing', projectId, 'sessions');
  const entries = readdirSyncSafe(dir)
    .map((id) => {
      try {
        return { id, mtime: statSync(join(dir, id)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.id ?? null;
}

// ── run lifecycle ───────────────────────────────────────────────────────────────
function spawnServer(run) {
  mkdirSync(run.dataDir, { recursive: true });
  const logFd = openSync(run.logFile, 'a');
  // Spawn FROM sdk/org so `pnpm lmthing` resolves the workspace script; `--cwd <data>` then chdirs
  // the server process into the run's data dir (applyCwd in bin.ts), so `.lmthing` lands there.
  // Detached → own process group → the whole pnpm→tsx→node tree is one killable unit.
  const child = spawn(
    'pnpm',
    [...BIN_ARGS, '--cwd', run.dataDir, '--port', String(run.port), '--env-file', ENV_FILE, '--adopt-system-spaces', '--max-sessions', '40'],
    {
      cwd: SDK_ORG,
      env: { ...process.env, LM_STORE_APPS_DIR: join(run.dataDir, 'store-apps') },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  );
  closeSync(logFd);
  child.unref();
  run.serverPid = child.pid;
}

/**
 * Start a fresh per-run server and return the `run` handle. Allocates a free port, seeds the data
 * dir from a snapshot first when resuming, boots the server, and records `run.json` + a `latest`
 * pointer. Retries once on a lost port race.
 */
export async function startRun({ scenarioDir, runId, projectId, scenarioId, seedFrom = null }) {
  const dir = runDir(scenarioDir, runId);
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const run = {
    runId,
    scenarioId,
    projectId,
    scenarioDir,
    dir,
    dataDir,
    logFile: join(dir, 'sessions.log'),
    port: null,
    base: null,
    serverPid: null,
  };

  if (seedFrom) seedRun(run, seedFrom);

  for (let attempt = 0; attempt < 2; attempt++) {
    run.port = await allocatePort();
    run.base = `http://localhost:${run.port}`;
    spawnServer(run);
    if (await waitUp(run.base)) {
      writeRunJson(run, { seededFrom: seedFrom ?? null });
      updateLatest(scenarioDir, runId);
      return run;
    }
    stopRun(run); // port race or boot failure — reap and retry once
  }
  throw new Error(`run ${runId} server never listened (see ${run.logFile})`);
}

/** Kill a run's server for good: SIGKILL the process group, then reap anything still on the port. */
export function stopRun(run) {
  if (!run) return;
  if (run.serverPid) {
    try {
      process.kill(-run.serverPid, 'SIGKILL'); // negative → the detached group (whole tree)
    } catch {
      try {
        process.kill(run.serverPid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  if (run.port) killPort(run.port);
}

/**
 * Restart a run's server in place (the `restart_pod` verb / `Pod.restart`) — same data dir + port,
 * so the on-disk project survives and the persisted session resumes; only in-memory VM state drops.
 */
export async function restartRun(run) {
  stopRun(run);
  for (let i = 0; i < 30 && (await serverUp(run.base)); i++) await sleep(1000);
  spawnServer(run);
  if (!(await waitUp(run.base))) throw new Error(`run ${run.runId} did not come back up (see ${run.logFile})`);
  writeRunJson(run, {});
  return run;
}

/** Kill any run server whose owning run-scenario (`runner.pid`) is dead — reaps SIGKILL leaks. */
export function reapOrphanRuns(scenarioDir) {
  for (const r of listRuns(scenarioDir)) {
    if (!r.alive) continue;
    let ownerAlive = false;
    try {
      ownerAlive = pidAlive(Number(readFileSync(join(r.dir, 'runner.pid'), 'utf8').trim()));
    } catch {
      ownerAlive = false; // no pidfile → owner gone
    }
    if (!ownerAlive) stopRun({ serverPid: r.serverPid, port: r.port });
  }
}

// ── ad-hoc server (standalone probes: smoke.mjs, probe-*.mjs) ─────────────────────
// The probe scripts call getUser()/provisionUser() with no scenario run of their own; give them ONE
// lazily-started per-run server under `.state/adhoc/` and reap it when the probe process exits.
let _adhoc = null;
export async function ensureAdhocServer() {
  if (_adhoc && (await serverUp(_adhoc.base))) return _adhoc.base;
  const scenarioDir = join(STATE_DIR, 'adhoc');
  mkdirSync(runsDir(scenarioDir), { recursive: true });
  _adhoc = await startRun({ scenarioDir, runId: nextRunId(scenarioDir), projectId: 'user', scenarioId: 'adhoc' });
  const kill = () => stopRun(_adhoc);
  process.on('exit', kill);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { kill(); process.exit(130); });
  return _adhoc.base;
}

/** Restart the ad-hoc probe server in place (the `restart_pod` equivalent for standalone probes). */
export async function restartAdhocServer() {
  if (_adhoc) return restartRun(_adhoc);
}

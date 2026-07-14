/**
 * Local target — run scenarios against a single `lmthing serve` on localhost instead of a
 * provisioned prod pod. This is the FAST path: a product-code fix is `pnpm build` + restart this
 * one server (seconds), not push → CI image build → ArgoCD rollout → re-verify (minutes).
 *
 * The pod does NO auth of its own (Envoy validates the gateway JWT at the edge in prod); locally
 * there is no edge, so the server accepts every request token-free. So a "user" here is just the
 * shared local base URL with `token: null` — see `provisionUser()` in gateway.mjs.
 *
 * ONE shared server, MANY projects: every scenario writes to its OWN projectId (latam /
 * tanzania-trip / life-admin / …), so concurrent lanes never collide on the single runtime root.
 * They DO share one Node event loop, so lanes are coupled (a rebuild-restart by one lane briefly
 * drops the others' in-memory sessions — the harness re-resumes them from the persisted id).
 *
 * The server is spawned DETACHED and tracked by a pidfile so it outlives the `claude -p` agent
 * process that first started it, and so a later lane (or a rebuild-restart) attaches to / cycles
 * the same instance instead of racing up a second one. Startup is guarded by an exclusive lock so
 * two lanes booting at once cannot both spawn.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SDK_ORG, STATE_DIR } from './paths.mjs';

export const LOCAL_PORT = Number(process.env.LM_LOCAL_PORT ?? 8080);
export const LOCAL_BASE = `http://localhost:${LOCAL_PORT}`;

/** True when the whole harness should target the local server rather than a prod pod. */
export const LOCAL =
  process.env.SCENARIO_TARGET === 'local' || /localhost|127\.0\.0\.1/.test(process.env.LM_POD_BASE ?? '');

/**
 * State (pidfile, log, pod-root) is keyed by PORT, so a lane that wants ISOLATION can set
 * `LM_LOCAL_PORT` and get its own server instead of sharing the default one. That matters because a
 * restart is not a private act: `local-server.mjs restart` kills the shared process, and every other
 * lane's in-flight turn dies with it. A scenario whose authoring turns run 10+ minutes cannot
 * survive on a server that its siblings rebuild every few minutes — it gets interrupted, re-sends,
 * and burns the budget again. The default port keeps the original shared dir, so nothing moves for
 * lanes that are happy sharing.
 */
const DIR = join(STATE_DIR, LOCAL_PORT === 8080 ? 'local-server' : `local-server-${LOCAL_PORT}`);
const PID_FILE = join(DIR, 'pid');
const LOCK_FILE = join(DIR, 'starting.lock');
const LOG_FILE = join(DIR, 'serve.log');
/** Dedicated runtime root so scenario projects never touch a dev `<cwd>/.lmthing`. */
const POD_ROOT = join(DIR, 'pod-root');
const BIN = join(SDK_ORG, 'libs', 'cli', 'dist', 'cli', 'bin.js');

/** Does the server answer at all? `GET /api/projects` needs no body/auth and is cheap. */
export async function serverUp(base = LOCAL_BASE, { timeoutMs = 1500 } = {}) {
  try {
    const ctl = AbortSignal.timeout(timeoutMs);
    const res = await fetch(`${base}/api/projects`, { signal: ctl });
    return res.status > 0; // any HTTP answer means it's listening
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

function readPid() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(base, { attempts = 120, everyMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await serverUp(base)) return true;
    await sleep(everyMs);
  }
  return false;
}

/**
 * Guarantee a local server is listening; return its base URL. Idempotent and race-safe across
 * concurrent lanes: whoever wins the exclusive lock spawns it, everyone else waits for it to come
 * up. A stale lock (holder died before writing a live pid) is broken after a grace period.
 */
export async function ensureLocalServer() {
  if (await serverUp()) return LOCAL_BASE;
  mkdirSync(DIR, { recursive: true });
  mkdirSync(POD_ROOT, { recursive: true });

  // Exclusive-create the lock. If someone else holds it, they're booting — wait for the port.
  let lockFd;
  try {
    lockFd = openSync(LOCK_FILE, 'wx');
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
    // Break a stale lock (>90s old and no live server, no live pid) so a crashed boot can't wedge us.
    const stale = Date.now() - safeMtime(LOCK_FILE) > 90_000;
    if (stale && !(await serverUp()) && !pidAlive(readPid())) {
      rmSync(LOCK_FILE, { force: true });
      return ensureLocalServer();
    }
    if (await waitUp(LOCAL_BASE)) return LOCAL_BASE;
    throw new Error('local server never came up (another lane held the start lock)');
  }

  try {
    // A pid may already be live even though the probe missed (mid-boot) — attach to it.
    if (pidAlive(readPid()) && (await waitUp(LOCAL_BASE, { attempts: 30 }))) return LOCAL_BASE;

    const logFd = openSync(LOG_FILE, 'a');
    // `--adopt-system-spaces`: this pod-root is a throwaway we own, so always take the freshly
    // built system-space tree (dist/system-spaces) on restart — that's how an agent's system-space
    // prompt improvements land after `pnpm build && local-server.mjs restart`.
    // `--max-sessions`: the default (8) is sized for ONE user's chat tabs. This server is shared by
    // every scenario lane at once, and a single authoring turn adds a delegate sub-session per
    // specialist it fans out to — so a handful of concurrent lanes blow past 8 easily, and the
    // capacity gate then sheds sessions the lanes are still using.
    const child = spawn(process.execPath, [BIN, 'serve', '--port', String(LOCAL_PORT), '--adopt-system-spaces', '--max-sessions', '40'], {
      cwd: SDK_ORG, // read sdk/org/.env → Azure keys credential the agents (budget-free direct Azure)
      env: { ...process.env, LMTHING_ROOT: join(POD_ROOT, '.lmthing') },
      detached: true, // own process group → survives the agent, killable as a tree
      stdio: ['ignore', logFd, logFd],
    });
    closeSync(logFd);
    child.unref();
    writeFileSync(PID_FILE, String(child.pid));
    if (!(await waitUp(LOCAL_BASE))) throw new Error(`local server did not listen on :${LOCAL_PORT} — see ${LOG_FILE}`);
    return LOCAL_BASE;
  } finally {
    closeSync(lockFd);
    rmSync(LOCK_FILE, { force: true });
  }
}

function safeMtime(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** Kill the local server (whole process group) and clear its pidfile. */
export function stopLocalServer() {
  const pid = readPid();
  if (pidAlive(pid)) {
    try {
      process.kill(-pid, 'SIGTERM'); // negative → the detached group
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  rmSync(PID_FILE, { force: true });
}

/** Rebuild-then-restart flow: stop, wait for the port to free, bring a fresh server up. */
export async function restartLocalServer() {
  stopLocalServer();
  for (let i = 0; i < 30 && (await serverUp()); i++) await sleep(1000);
  return ensureLocalServer();
}

export function localStatus() {
  const pid = readPid();
  return { base: LOCAL_BASE, pid, alive: pidAlive(pid), podRoot: POD_ROOT, log: LOG_FILE };
}

#!/usr/bin/env node
// `pnpm thing` — dev loop where the CLI SERVES the web app and BOTH hot-reload,
// all on ONE port (default 8080). There is no separate Vite dev-server port:
// the CLI runs Vite in-process (middleware mode) and attaches HMR to its own
// HTTP server (see libs/cli/src/server/dev-web.ts).
//
//   1. `tsup --watch` for @lmthing/cli  → rebuilds the CLI on source change.
//   2. `lmthing serve` with LM_DEV_WEB   → serves /api + the agent WS AND the
//      web app (Vite HMR) on http://localhost:$THING_PORT. Auto-restarts when
//      the CLI rebuilds.
//
// Lives in the sdk/org submodule (self-locating the org root) so it works both
// standalone and from the monorepo root (root `pnpm thing` delegates here).
//
// Env overrides:
//   THING_PORT  — CLI serve port          (default 8080)
//   THING_CWD   — cwd for `lmthing serve`  (default the org root, so its .env +
//                 .lmthing runtime root live there)

import { spawn } from 'node:child_process';
import { watch, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

/** Walk up from this script to the sdk/org root (the dir with libs/cli + apps/web). */
function findOrgRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, 'libs', 'cli')) && existsSync(join(dir, 'apps', 'web'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('could not locate sdk/org root (libs/cli + apps/web)');
    dir = parent;
  }
}

const root = findOrgRoot(dirname(fileURLToPath(import.meta.url)));
const cliDist = resolve(root, 'libs/cli/dist');
const cliBin = resolve(cliDist, 'cli/bin.js');
const webDir = resolve(root, 'apps/web');

const SERVE_PORT = process.env.THING_PORT || '8080';
const serveCwd = process.env.THING_CWD ? resolve(process.env.THING_CWD) : root;

const children = [];
let shuttingDown = false;

function log(msg) {
  process.stdout.write(`\x1b[35m[thing]\x1b[0m ${msg}\n`);
}

function run(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code && code !== 0) {
      log(`${label} exited with code ${code}${signal ? ` (${signal})` : ''}`);
    }
  });
  return child;
}

// 1. CLI — rebuild dist on every source change.
log('starting CLI watch build (tsup --watch)');
run('cli-build', 'pnpm', ['--filter', '@lmthing/cli', 'dev'], { cwd: root });

// 2. CLI serve — single front door: /api + agent WS + the web app (Vite HMR).
let serveProc = null;
let restartTimer = null;

function startServe() {
  log(`serving on http://localhost:${SERVE_PORT} (web app + /api, HMR on same port)`);
  serveProc = spawn('node', [cliBin, 'serve', '--port', SERVE_PORT], {
    stdio: 'inherit',
    cwd: serveCwd,
    env: { ...process.env, LM_DEV_WEB: webDir },
  });
  serveProc.on('exit', (code, signal) => {
    if (shuttingDown || restartTimer) return;
    if (code && code !== 0) log(`serve exited with code ${code}${signal ? ` (${signal})` : ''}`);
  });
}

function restartServe(reason) {
  if (shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    log(`CLI changed (${reason}) — restarting serve`);
    if (serveProc && !serveProc.killed) {
      serveProc.once('exit', startServe);
      serveProc.kill('SIGTERM');
    } else {
      startServe();
    }
  }, 300);
}

// Wait for the first CLI build, then serve + watch dist for rebuilds.
function waitForBinThenServe() {
  if (existsSync(cliBin)) {
    startServe();
    watch(cliDist, { recursive: true }, (_evt, file) => {
      if (file && String(file).endsWith('.js')) restartServe(String(file));
    });
    return;
  }
  setTimeout(waitForBinThenServe, 400);
}
log('waiting for first CLI build…');
waitForBinThenServe();

// ─── Teardown ─────────────────────────────────────────────────────────────────
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down…');
  clearTimeout(restartTimer);
  if (serveProc && !serveProc.killed) serveProc.kill('SIGTERM');
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 200);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

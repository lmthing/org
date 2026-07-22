// Lightpanda browser backend for the CLI.
//
// The `system-browser` space (libs/core/system-spaces/system-browser) drives a
// headless Lightpanda browser by POSTing JSON-RPC `tools/call` requests to a
// Lightpanda MCP server at `LIGHTPANDA_MCP_URL` (default http://127.0.0.1:9223).
// Those calls come from inside the sandbox and can only reach the network via
// `fetch` — they cannot start a subprocess. So the HOST (this module) is what
// makes the CLI able to browse: it resolves an endpoint, and when a Lightpanda
// binary is available it spawns `lightpanda serve` for the session and points
// `LIGHTPANDA_MCP_URL` at it.
//
// Policy (predictable, non-surprising):
//   - `LIGHTPANDA_MCP_URL` set        → use that external server, never spawn.
//   - a binary is resolvable          → spawn `lightpanda serve` (unless
//     (`LIGHTPANDA_BIN` or on PATH)      `LIGHTPANDA_AUTOSTART` is falsey).
//   - nothing available               → no-op; browser functions will report
//                                        "unreachable" with a setup hint.
//
// Everything here is best-effort: a failure to start the browser must never
// abort the CLI — browsing simply stays unavailable.

import { spawn as realSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Minimal structural view of the spawned child — self-typed to stay independent
 *  of the workspace's (multi-version) `@types/node` `ChildProcess` resolution
 *  (mirrors `SpawnedProc` in server/routes/hooks.ts). */
interface SpawnedChild {
  once(ev: 'error', cb: (e: Error) => void): void;
  kill(): void;
}

export const DEFAULT_LIGHTPANDA_HOST = '127.0.0.1';
export const DEFAULT_LIGHTPANDA_PORT = 9223;

/** Resolve a Lightpanda binary: explicit `LIGHTPANDA_BIN` (must exist), else the
 *  first `lightpanda` found on `PATH`. Returns undefined when none is found. */
export function findLightpandaBinary(
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const explicit = env['LIGHTPANDA_BIN'];
  if (explicit && explicit.trim()) return exists(explicit) ? explicit : undefined;
  const pathVar = env['PATH'] ?? '';
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'lightpanda');
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/** argv for `lightpanda serve` — one process exposing both the CDP and MCP
 *  endpoints the browser functions talk to. */
export function lightpandaServeArgs(host: string, port: number): string[] {
  return ['serve', '--host', host, '--port', String(port)];
}

/** Whether the boolean-ish env value opts OUT of autostart. Anything except an
 *  explicit falsey value ('0', 'false', 'no', 'off', '') leaves autostart on. */
export function autostartDisabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ['0', 'false', 'no', 'off', ''].includes(raw.trim().toLowerCase());
}

/** JSON-RPC readiness probe: a `tools/list` that returns an HTTP-ok response. */
export async function pingLightpanda(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface EnsureBrowserDeps {
  env: NodeJS.ProcessEnv;
  spawn?: typeof realSpawn;
  fetchImpl?: typeof fetch;
  exists?: (p: string) => boolean;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Total readiness-poll budget after spawning (ms). */
  readyTimeoutMs?: number;
  /** Delay between readiness polls (ms). */
  pollIntervalMs?: number;
}

export interface EnsureBrowserResult {
  /** The resolved MCP endpoint, if one is available/started. */
  url?: string;
  /** True when this call spawned the Lightpanda process. */
  spawned: boolean;
  /** The spawned child, when `spawned` is true. */
  child?: SpawnedChild;
  /** Machine-readable outcome for tests/logging. */
  reason: 'external' | 'spawned' | 'spawn-not-ready' | 'no-binary' | 'autostart-disabled' | 'spawn-failed';
}

/**
 * Ensure a Lightpanda MCP endpoint is available for the session, per the policy
 * documented at the top of this file. Dependency-injected so it can be unit
 * tested without a real binary or network. Never throws.
 */
export async function ensureLightpanda(deps: EnsureBrowserDeps): Promise<EnsureBrowserResult> {
  const {
    env,
    spawn = realSpawn,
    fetchImpl = fetch,
    exists = existsSync,
    log = () => {},
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    readyTimeoutMs = 8000,
    pollIntervalMs = 150,
  } = deps;

  // 1. An explicit endpoint wins — assume the operator manages that server.
  const existing = env['LIGHTPANDA_MCP_URL'];
  if (existing && existing.trim()) {
    return { url: existing.trim(), spawned: false, reason: 'external' };
  }

  // 2. Autostart, if a binary is resolvable and not opted out.
  if (autostartDisabled(env['LIGHTPANDA_AUTOSTART'])) {
    return { spawned: false, reason: 'autostart-disabled' };
  }
  const bin = findLightpandaBinary(env, exists);
  if (!bin) {
    return { spawned: false, reason: 'no-binary' };
  }

  const host = env['LIGHTPANDA_HOST'] || DEFAULT_LIGHTPANDA_HOST;
  const port = Number(env['LIGHTPANDA_PORT']) || DEFAULT_LIGHTPANDA_PORT;
  const url = `http://${host}:${port}`;

  let child: SpawnedChild;
  try {
    child = spawn(bin, lightpandaServeArgs(host, port), { stdio: 'ignore' }) as unknown as SpawnedChild;
  } catch (e) {
    log(`[browser] failed to start Lightpanda (${bin}): ${String(e)}`);
    return { spawned: false, reason: 'spawn-failed' };
  }
  // A spawn that dies immediately (bad binary/args) must not leave us claiming success.
  let spawnError: unknown;
  child.once('error', (e) => { spawnError = e; });

  // Kill the child when the CLI exits so we don't leak a browser process.
  const kill = () => { try { child.kill(); } catch { /* already gone */ } };
  process.once('exit', kill);
  process.once('SIGINT', kill);
  process.once('SIGTERM', kill);

  // Poll until the MCP server answers or we run out of budget.
  const deadline = readyTimeoutMs;
  let waited = 0;
  while (waited < deadline) {
    if (spawnError) {
      log(`[browser] Lightpanda process error: ${String(spawnError)}`);
      return { spawned: false, child, reason: 'spawn-failed' };
    }
    if (await pingLightpanda(url, fetchImpl)) {
      env['LIGHTPANDA_MCP_URL'] = url;
      log(`[browser] Lightpanda ready at ${url}`);
      return { url, spawned: true, child, reason: 'spawned' };
    }
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;
  }
  // Started but never became ready in time. Still publish the URL — it may come
  // up shortly — but signal the degraded outcome.
  env['LIGHTPANDA_MCP_URL'] = url;
  log(`[browser] Lightpanda did not report ready within ${deadline}ms; browsing may be delayed`);
  return { url, spawned: true, child, reason: 'spawn-not-ready' };
}

/**
 * Thin wrapper used by the CLI entrypoint: run {@link ensureLightpanda} with real
 * dependencies against `process.env`, swallowing any failure. Returns the result
 * for callers that want to log, or nothing on unexpected error.
 */
export async function ensureBrowserBackend(log: (msg: string) => void = () => {}): Promise<EnsureBrowserResult | undefined> {
  try {
    return await ensureLightpanda({ env: process.env, log });
  } catch (e) {
    log(`[browser] ensureBrowserBackend error: ${String(e)}`);
    return undefined;
  }
}

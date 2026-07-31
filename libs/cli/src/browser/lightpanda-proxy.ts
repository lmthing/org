/**
 * A loopback stand-in for Lightpanda that installs the real thing on first use.
 *
 * ## The problem this solves
 *
 * A bundled `lmthing` ships without Lightpanda (156 MB — see
 * `lightpanda-install.ts`). The obvious alternatives are both wrong:
 *
 *   - **Download at startup.** Every run pays 156 MB for a feature most runs
 *     never touch.
 *   - **Download in the background at startup, report "unreachable" until it
 *     lands.** The first browse of a session fails and the second works, which
 *     an agent reads as a flaky browser and a person reads as a broken one.
 *
 * So `LIGHTPANDA_MCP_URL` is pointed at THIS server instead. It holds the first
 * request open while it installs and starts the real browser, then proxies that
 * request and every one after it. Nothing downloads until an agent actually
 * browses, and when one does, the call succeeds — it is merely slow once.
 *
 * ## Why the proxy stays in the path afterwards
 *
 * `process.env` is snapshot-copied into each VM at injection time, so a URL
 * republished after the browser came up would not reach any VM already running.
 * Re-pointing later is therefore not available, and a loopback hop is cheap next
 * to loading a page.
 *
 * ## How failure is reported
 *
 * As a JSON-RPC `error` on a 200, never an HTTP status. The wrappers in
 * `system-browser` surface `rpc.error.message` verbatim but flatten any non-2xx
 * into "lightpanda MCP returned HTTP 503" — which would tell an agent a server
 * rejected its call, when the truth is that a 156 MB download failed. The
 * message is the only channel that carries the actual cause.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { spawn as realSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { AddressInfo } from 'node:net';

import { DEFAULT_LIGHTPANDA_HOST, findLightpandaBinary, lightpandaServeArgs, pingLightpanda } from './lightpanda.js';
import { cachedLightpanda, installDisabled, installLightpanda } from './lightpanda-install.js';

/** Matches `SpawnedChild` in lightpanda.ts — self-typed for the same reason. */
interface SpawnedChild {
  once(ev: 'error', cb: (e: Error) => void): void;
  kill(): void;
}

export interface LightpandaProxy {
  /** The URL published as `LIGHTPANDA_MCP_URL`. */
  url: string;
  /** Resolves once the upstream browser is up (or has definitively failed). */
  ready(): Promise<{ ok: boolean; upstream?: string; reason?: string }>;
  close(): Promise<void>;
}

export interface ProxyDeps {
  env?: NodeJS.ProcessEnv;
  spawn?: typeof realSpawn;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  exists?: (p: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Readiness budget for the spawned browser (ms). */
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Injected for tests, so no download happens. */
  install?: typeof installLightpanda;
}

/** Ask the OS for a free loopback port by binding and releasing one. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, DEFAULT_LIGHTPANDA_HOST, () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

/**
 * Start the shim. Binds an ephemeral loopback port and returns immediately —
 * nothing is downloaded or spawned until a request arrives.
 */
export async function startLightpandaProxy(deps: ProxyDeps = {}): Promise<LightpandaProxy> {
  const {
    env = process.env,
    spawn = realSpawn,
    fetchImpl = fetch,
    log = () => {},
    exists = existsSync,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    readyTimeoutMs = 20_000,
    pollIntervalMs = 150,
    install = installLightpanda,
  } = deps;

  let child: SpawnedChild | undefined;
  /** The single ensure-upstream attempt; every request awaits this same promise. */
  let upstreamOnce: Promise<{ ok: boolean; upstream?: string; reason?: string }> | null = null;

  async function ensureUpstream(): Promise<{ ok: boolean; upstream?: string; reason?: string }> {
    // Already installed somewhere we can see? Then no download at all.
    let bin = findLightpandaBinary(env, exists) ?? cachedLightpanda(env, exists);

    if (!bin) {
      if (installDisabled(env['LIGHTPANDA_AUTO_INSTALL'])) {
        return {
          ok: false,
          reason:
            'the browser is not installed and automatic installation is disabled ' +
            '(LIGHTPANDA_AUTO_INSTALL is off) — run `lmthing browser install`, or set LIGHTPANDA_BIN',
        };
      }
      const res = await install({ env, log });
      if (!res.ok || !res.path) {
        return { ok: false, reason: res.reason ?? 'could not install the browser' };
      }
      bin = res.path;
    }

    const host = env['LIGHTPANDA_HOST'] || DEFAULT_LIGHTPANDA_HOST;
    const port = Number(env['LIGHTPANDA_PORT']) || (await freePort());
    const upstream = `http://${host}:${port}`;

    let spawnError: unknown;
    try {
      child = spawn(bin, lightpandaServeArgs(host, port), { stdio: 'ignore' }) as unknown as SpawnedChild;
    } catch (e) {
      return { ok: false, reason: `could not start the browser (${bin}): ${String(e)}` };
    }
    child.once('error', (e) => {
      spawnError = e;
    });

    const kill = () => {
      try {
        child?.kill();
      } catch {
        /* already gone */
      }
    };
    process.once('exit', kill);
    process.once('SIGINT', kill);
    process.once('SIGTERM', kill);

    let waited = 0;
    while (waited < readyTimeoutMs) {
      if (spawnError) return { ok: false, reason: `the browser process failed: ${String(spawnError)}` };
      if (await pingLightpanda(upstream, fetchImpl)) {
        log(`[browser] Lightpanda ready at ${upstream}`);
        return { ok: true, upstream };
      }
      await sleep(pollIntervalMs);
      waited += pollIntervalMs;
    }
    return { ok: false, reason: `the browser did not become ready within ${readyTimeoutMs}ms` };
  }

  function ready() {
    if (!upstreamOnce) upstreamOnce = ensureUpstream();
    return upstreamOnce;
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      rpcError(res, null, `browser bridge failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);

    // A GET is a human with curl, not the agent — answer it plainly rather than
    // triggering a 156 MB download because someone checked whether this is alive.
    if (req.method === 'GET') {
      const started = upstreamOnce ? await upstreamOnce : null;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          bridge: 'lmthing lightpanda shim',
          browser: started ? (started.ok ? 'ready' : 'failed') : 'not started (installs on first tools/call)',
          upstream: started?.upstream,
          reason: started?.reason,
        }),
      );
      return;
    }

    const id = parseRpcId(body);
    const up = await ready();
    if (!up.ok || !up.upstream) {
      rpcError(res, id, `${up.reason} — browsing is unavailable until this is resolved`);
      return;
    }

    let proxied: Response;
    try {
      proxied = await fetchImpl(up.upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
      });
    } catch (e) {
      // The browser was up and has now gone. Say so — it is a different problem
      // from never having had one, and the remedy is different too.
      rpcError(res, id, `the browser stopped responding at ${up.upstream} (${String(e)})`);
      return;
    }

    const text = await proxied.text();
    res.writeHead(proxied.status, {
      'content-type': proxied.headers.get('content-type') ?? 'application/json',
    });
    res.end(text);
  }

  await new Promise<void>((resolve) => server.listen(0, DEFAULT_LIGHTPANDA_HOST, resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://${DEFAULT_LIGHTPANDA_HOST}:${port}`;
  log(`[browser] browser bridge listening at ${url} (Lightpanda installs on first use)`);

  return {
    url,
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        try {
          child?.kill();
        } catch {
          /* already gone */
        }
        server.close(() => resolve());
      }),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** The request's JSON-RPC id, so the reply can be correlated. Null when unparseable. */
function parseRpcId(body: string): unknown {
  try {
    return (JSON.parse(body) as { id?: unknown }).id ?? null;
  } catch {
    return null;
  }
}

/**
 * A JSON-RPC error on a 200. See the note at the top of this file: a non-2xx is
 * flattened by the wrappers into an HTTP status, which loses the cause.
 */
function rpcError(res: ServerResponse, id: unknown, message: string): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32001, message } }));
}

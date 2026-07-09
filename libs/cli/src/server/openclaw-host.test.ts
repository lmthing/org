/**
 * OpenClaw plugin wiring (pod-only increment) — offline, deterministic.
 * Covers:
 *   - `loadOpenClawPlugins` loading a fixture plugin (an HTTP route that
 *     calls `api.runtime.subagent.run(...)`) into a fake `ComputeCompatHost`'s
 *     shared route table (Test A);
 *   - `createInboundHandler`'s `pluginRoutes` fallback: no webhook-hook/
 *     space-trigger binding matches `:path`, but a plugin-mounted route does
 *     → the plugin handler runs (and, through it, `host.runAgent`), and its
 *     result is returned verbatim; an unknown path with neither a binding
 *     nor a plugin route still 404s (Test B).
 *   - a missing `.openclaw-plugins/` dir is a clean no-op (empty registry,
 *     untouched route table).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CompatHost, CompatRunAgentOptions } from '@lmthing/openclaw-compat';

import { loadOpenClawPlugins, type ComputeCompatHost, type OpenClawRouteTable } from './openclaw-host.js';
import { createInboundHandler, type InboundManager } from './routes/webhooks.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** Write a synthetic OpenClaw plugin fixture (mirrors
 *  `libs/openclaw-compat/test/echo-plugin/`) whose `register(api)` mounts ONE
 *  HTTP route (`POST /echo`) that routes the raw request body into
 *  `api.runtime.subagent.run(...)` and echoes the result back. */
async function writeEchoRoutePlugin(pluginsDir: string, name: string): Promise<string> {
  const dir = join(pluginsDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: `${name}-fixture`, private: true, version: '0.0.0', openclaw: { extensions: ['./index.ts'] } }),
    'utf8',
  );
  await writeFile(join(dir, 'openclaw.plugin.json'), JSON.stringify({ id: name }), 'utf8');
  await writeFile(
    join(dir, 'index.ts'),
    `
    function definePluginEntryLocal(entry) { return entry; }

    export default definePluginEntryLocal({
      id: '${name}',
      register(api) {
        api.registerHttpRoute({
          method: 'POST',
          path: '/echo',
          handler: async (req) => {
            const r = await api.runtime.subagent.run({ sessionKey: 'k', message: req.body });
            return { status: 200, body: r };
          },
        });
      },
    });
    `,
    'utf8',
  );
  return dir;
}

/** A fake `ComputeCompatHost` that does NOT go through `createComputeCompatHost` /
 *  a real `SessionManager` — `runAgent` just records the call and returns a
 *  synthetic result, so Test A/B exercise `loadOpenClawPlugins` + the plugin
 *  fixture + the inbound dispatcher's fallback wiring in isolation. */
function createFakeHost(): {
  host: ComputeCompatHost;
  routeTable: OpenClawRouteTable;
  runAgentCalls: CompatRunAgentOptions[];
  logs: string[];
} {
  const routeTable: OpenClawRouteTable = new Map();
  const runAgentCalls: CompatRunAgentOptions[] = [];
  const logs: string[] = [];
  const host: CompatHost & { routeTable: OpenClawRouteTable } = {
    routeTable,
    async runAgent(opts) {
      runAgentCalls.push(opts);
      return { ok: true, result: `RAN:${opts.message}` };
    },
    mountRoute(method, path, handler) {
      routeTable.set(path.startsWith('/') ? path.slice(1) : path, { method: method.toUpperCase(), handler });
    },
    log(msg) {
      logs.push(msg);
    },
  };
  return { host: host as ComputeCompatHost, routeTable, runAgentCalls, logs };
}

describe('loadOpenClawPlugins', () => {
  it('loads a fixture plugin and mounts its HTTP route into the shared route table', async () => {
    const pluginsDir = await makeTmpDir('lmthing-openclaw-plugins-');
    await writeEchoRoutePlugin(pluginsDir, 'echo-route');

    const { host, routeTable, runAgentCalls } = createFakeHost();
    const { registry } = await loadOpenClawPlugins(pluginsDir, host, () => {});

    expect(registry.httpRoutes).toHaveLength(1);
    expect(routeTable.has('echo')).toBe(true);
    expect(routeTable.get('echo')).toMatchObject({ method: 'POST' });

    // Invoking the mounted handler routes into host.runAgent, carrying the
    // request body through as the agent message.
    const route = routeTable.get('echo')!;
    const response = await route.handler({ method: 'POST', path: '/echo', headers: {}, body: 'hi-from-test' });
    expect(runAgentCalls).toHaveLength(1);
    expect(runAgentCalls[0]!.message).toBe('hi-from-test');
    expect(response).toEqual({ status: 200, body: { ok: true, result: 'RAN:hi-from-test' } });
  });

  it('is a clean no-op when the plugins dir does not exist', async () => {
    const pluginsDir = join(await makeTmpDir('lmthing-openclaw-noop-'), 'does-not-exist');
    const { host, routeTable } = createFakeHost();

    const { registry } = await loadOpenClawPlugins(pluginsDir, host, () => {});

    expect(registry.httpRoutes).toHaveLength(0);
    expect(routeTable.size).toBe(0);
  });

  it('skips a broken plugin (best-effort) without throwing', async () => {
    const pluginsDir = await makeTmpDir('lmthing-openclaw-broken-');
    const dir = join(pluginsDir, 'broken');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'broken', openclaw: { extensions: ['./index.ts'] } }), 'utf8');
    await writeFile(join(dir, 'openclaw.plugin.json'), JSON.stringify({ id: 'broken' }), 'utf8');
    await writeFile(join(dir, 'index.ts'), `throw new Error('boom at load time');`, 'utf8');

    const { host, routeTable } = createFakeHost();
    const logs: string[] = [];
    const { registry } = await loadOpenClawPlugins(pluginsDir, host, (msg) => logs.push(msg));

    expect(registry.httpRoutes).toHaveLength(0);
    expect(routeTable.size).toBe(0);
    expect(logs.some((l) => l.includes('failed to load plugin'))).toBe(true);
  });
});

// ── Handler wiring: pluginRoutes fallback on POST /api/inbound/:path ──────

function fakeReq(body: string, headers: Record<string, string> = {}, method = 'POST'): IncomingMessage {
  async function* gen() {
    yield Buffer.from(body, 'utf8');
  }
  const req = gen() as unknown as IncomingMessage;
  (req as unknown as { headers: Record<string, string>; method: string; url: string }).headers = headers;
  (req as unknown as { method: string }).method = method;
  (req as unknown as { url: string }).url = '/api/inbound/echo';
  return req;
}

function fakeRes(): { res: ServerResponse; get: () => { status: number; body: unknown } } {
  let status = 0;
  let body: unknown;
  const res = {
    writeHead(s: number) {
      status = s;
    },
    end(data?: string) {
      body = data ? JSON.parse(data) : undefined;
    },
  } as unknown as ServerResponse;
  return { res, get: () => ({ status, body }) };
}

describe('createInboundHandler — pluginRoutes fallback', () => {
  it('routes to a plugin-mounted HTTP route when no webhook binding matches, and returns its result', async () => {
    const root = await makeTmpDir('lmthing-openclaw-inbound-');
    const pluginsDir = join(root, '.openclaw-plugins');
    await writeEchoRoutePlugin(pluginsDir, 'echo-route');

    const { host, routeTable, runAgentCalls } = createFakeHost();
    await loadOpenClawPlugins(pluginsDir, host, () => {});
    expect(routeTable.has('echo')).toBe(true);

    const manager: InboundManager = {
      listProjects: async () => [],
      runHeadless: async () => {
        throw new Error('unexpected: no binding should match, so no agent run here');
      },
      runHeadlessThreaded: async () => {
        throw new Error('unexpected: no binding should match, so no agent run here');
      },
    };

    const handler = createInboundHandler(manager, root, routeTable);
    const { res, get } = fakeRes();
    await handler(fakeReq('hello-plugin'), res, { path: 'echo' });

    const { status, body } = get();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, result: 'RAN:hello-plugin' });

    expect(runAgentCalls).toHaveLength(1);
    expect(runAgentCalls[0]!.message).toBe('hello-plugin');
  });

  it('still 404s an unknown path with neither a binding nor a plugin route', async () => {
    const root = await makeTmpDir('lmthing-openclaw-inbound-404-');
    const routeTable: OpenClawRouteTable = new Map();

    const manager: InboundManager = {
      listProjects: async () => [],
      runHeadless: async () => ({ ok: true }),
      runHeadlessThreaded: async () => ({ ok: true }),
    };

    const handler = createInboundHandler(manager, root, routeTable);
    const { res, get } = fakeRes();
    await handler(fakeReq('{}'), res, { path: 'nope' });

    expect(get().status).toBe(404);
  });

  it('the pluginRoutes param stays optional — omitting it behaves exactly like before', async () => {
    const root = await makeTmpDir('lmthing-openclaw-inbound-optional-');
    const manager: InboundManager = {
      listProjects: async () => [],
      runHeadless: async () => ({ ok: true }),
      runHeadlessThreaded: async () => ({ ok: true }),
    };

    const handler = createInboundHandler(manager, root);
    const { res, get } = fakeRes();
    await handler(fakeReq('{}'), res, { path: 'nope' });

    expect(get().status).toBe(404);
  });
});

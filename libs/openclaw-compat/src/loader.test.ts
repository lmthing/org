import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createCompatApi } from './api.js';
import { loadPlugin } from './loader.js';
import { PluginRegistry } from './registry.js';
import { UnsupportedCompatError, type CompatHost, type CompatRunAgentOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECHO_FIXTURE_DIR = join(__dirname, '..', 'test', 'echo-plugin');

function createFakeHost() {
  const mountedRoutes: Array<{ method: string; path: string }> = [];
  const routeHandlers = new Map<string, (req: unknown) => unknown>();
  const runAgentCalls: CompatRunAgentOptions[] = [];
  const logs: string[] = [];

  const host: CompatHost = {
    async runAgent(opts) {
      runAgentCalls.push(opts);
      return { ok: true, result: `ran:${opts.message}` };
    },
    mountRoute(method, path, handler) {
      mountedRoutes.push({ method, path });
      routeHandlers.set(`${method} ${path}`, handler);
    },
    log(msg) {
      logs.push(msg);
    },
  };

  return { host, mountedRoutes, routeHandlers, runAgentCalls, logs };
}

describe('openclaw-compat foundation: load echo fixture', () => {
  it('registers a tool, mounts an HTTP route, and routes into host.runAgent', async () => {
    const registry = new PluginRegistry();
    const { host, mountedRoutes, routeHandlers, runAgentCalls } = createFakeHost();
    const api = createCompatApi(host, registry);

    const { id } = await loadPlugin(ECHO_FIXTURE_DIR, api);
    expect(id).toBe('echo');

    // Tool registered in the registry.
    expect(registry.tools.has('echo')).toBe(true);
    const tool = registry.getTool('echo');
    expect(tool).toBeDefined();
    const toolResult = await tool!.execute('call-1', { text: 'direct-call' });
    expect(toolResult).toEqual({ content: [{ type: 'text', text: 'direct-call' }] });

    // HTTP route mounted via host.mountRoute.
    expect(mountedRoutes).toEqual([{ method: 'POST', path: '/echo' }]);
    expect(registry.httpRoutes).toHaveLength(1);
    expect(registry.httpRoutes[0]).toMatchObject({ method: 'POST', path: '/echo' });

    // Invoking the mounted handler routes into host.runAgent and returns its result.
    const handler = routeHandlers.get('POST /echo');
    expect(handler).toBeTypeOf('function');
    const response = await handler!({ method: 'POST', path: '/echo', headers: {}, body: 'hello' });

    expect(runAgentCalls).toHaveLength(1);
    expect(runAgentCalls[0].sessionKey).toBe('echo');
    expect(runAgentCalls[0].message).toBe('hello');

    expect(response).toEqual({ status: 200, body: { ok: true, result: 'ran:hello' } });
  });
});

describe('openclaw-compat foundation: unsupported api surface', () => {
  it('throws UnsupportedCompatError for an unimplemented top-level method', () => {
    const registry = new PluginRegistry();
    const { host } = createFakeHost();
    const api = createCompatApi(host, registry) as Record<string, (...args: unknown[]) => unknown>;

    // `registerProvider` (unlike `registerWebSearchProvider`) is now a
    // record-only implemented method (see `tavily-load.test.ts`), so
    // `registerGatewayMethod` stands in as the still-unimplemented example.
    expect(() => api.registerGatewayMethod({})).toThrow(UnsupportedCompatError);
    expect(() => api.registerGatewayMethod({})).toThrow(/api\.registerGatewayMethod/);
  });

  it('throws UnsupportedCompatError for an unimplemented nested namespace method', () => {
    const registry = new PluginRegistry();
    const { host } = createFakeHost();
    const api = createCompatApi(host, registry) as unknown as {
      session: { getUser: (...args: unknown[]) => unknown };
    };

    expect(() => api.session.getUser()).toThrow(UnsupportedCompatError);
    expect(() => api.session.getUser()).toThrow(/api\.session\.getUser/);
  });

  it('throws UnsupportedCompatError for an unimplemented runtime method', () => {
    const registry = new PluginRegistry();
    const { host } = createFakeHost();
    const api = createCompatApi(host, registry) as unknown as {
      runtime: { subagent: { spawn: (...args: unknown[]) => unknown } };
    };

    expect(() => api.runtime.subagent.spawn()).toThrow(UnsupportedCompatError);
  });
});

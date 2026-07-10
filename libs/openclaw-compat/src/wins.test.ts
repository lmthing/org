/**
 * Coverage-widening increments (the "3 wins"):
 *   #1 broaden HTTP-route loadability — `api.logger`, method-less route shape,
 *      read-only `api.pluginConfig`/`api.config`.
 *   #2 expose a `createTool`-bearing web-search/fetch provider as an agent tool.
 *   #3 load `defineBundledChannelEntry` (webhook-mode) instead of rejecting it,
 *      plus the raw-descriptor fallback.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createCompatApi } from './api.js';
import { loadPlugin } from './loader.js';
import { PluginRegistry } from './registry.js';
import type { CompatHost } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(__dirname, '..', 'test', name);

function createFakeHost() {
  const mountedRoutes: Array<{ method: string; path: string }> = [];
  const routeHandlers = new Map<string, (req: unknown) => unknown>();
  const logs: string[] = [];
  const host: CompatHost = {
    async runAgent(opts) {
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
  return { host, mountedRoutes, routeHandlers, logs };
}

// ── Win #1 ──────────────────────────────────────────────────────────────────
describe('win #1: broaden HTTP-route loadability', () => {
  it('exposes api.logger, api.pluginConfig and api.config', () => {
    const { host } = createFakeHost();
    const api = createCompatApi(host, new PluginRegistry(), {
      pluginConfig: { routes: [{ path: 'x' }] },
      config: { env: 'test' },
    }) as Record<string, any>;
    expect(api.pluginConfig).toEqual({ routes: [{ path: 'x' }] });
    expect(api.config).toEqual({ env: 'test' });
    expect(typeof api.logger.info).toBe('function');
    // optional-call form real plugins use (`api.logger.info?.(...)`) doesn't throw.
    expect(() => api.logger.info?.('hello', { a: 1 })).not.toThrow();
    expect(typeof api.logger.warn).toBe('function');
  });

  it('defaults pluginConfig/config to {} (config-reading plugins load, not throw)', () => {
    const { host } = createFakeHost();
    const api = createCompatApi(host, new PluginRegistry()) as Record<string, any>;
    expect(api.pluginConfig).toEqual({});
    expect(api.config).toEqual({});
  });

  it('accepts a method-less route (OpenClaw shape) and defaults to POST', () => {
    const { host, mountedRoutes } = createFakeHost();
    const registry = new PluginRegistry();
    const api = createCompatApi(host, registry) as Record<string, any>;
    api.registerHttpRoute({ path: '/hook', auth: 'plugin', match: 'exact', handler: () => ({ status: 200 }) });
    expect(mountedRoutes).toEqual([{ method: 'POST', path: '/hook' }]);
    expect(registry.httpRoutes[0]).toMatchObject({ method: 'POST', path: '/hook' });
  });

  it('still requires path + handler', () => {
    const { host } = createFakeHost();
    const api = createCompatApi(host, new PluginRegistry()) as Record<string, any>;
    expect(() => api.registerHttpRoute({ path: '/x' })).toThrow(/requires \{ path, handler \}/);
    expect(() => api.registerHttpRoute({ handler: () => ({ status: 200 }) })).toThrow(/requires \{ path, handler \}/);
  });
});

// ── Win #2 ──────────────────────────────────────────────────────────────────
describe('win #2: expose search/fetch providers as tools', () => {
  it('registers a web-search provider tool from createTool(ctx) and forwards params', async () => {
    const { host } = createFakeHost();
    const registry = new PluginRegistry();
    const api = createCompatApi(host, registry) as Record<string, any>;

    api.registerWebSearchProvider({
      id: 'brave',
      createTool: (_ctx: unknown) => ({
        name: 'brave_search',
        description: 'Search the web using Brave',
        parameters: { type: 'object' },
        execute: async (args: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(args) }] }),
      }),
    });

    const tool = registry.getTool('brave_search');
    expect(tool).toBeDefined();
    expect(tool!.description).toMatch(/Brave/);
    // host resolver calls execute(toolCallId, params); the provider tool sees params.
    const out = (await tool!.execute('call-1', { query: 'hi' })) as { content: Array<{ text: string }> };
    expect(JSON.parse(out.content[0]!.text)).toEqual({ query: 'hi' });
  });

  it('derives a tool name from provider.id when the tool has none, per kind', () => {
    const { host } = createFakeHost();
    const registry = new PluginRegistry();
    const api = createCompatApi(host, registry) as Record<string, any>;
    api.registerWebSearchProvider({ id: 'exa', createTool: () => ({ execute: async () => ({ content: [] }) }) });
    api.registerWebFetchProvider({ id: 'firecrawl', createTool: () => ({ execute: async () => ({ content: [] }) }) });
    expect(registry.getTool('exa_search')).toBeDefined();
    expect(registry.getTool('firecrawl_fetch')).toBeDefined();
  });

  it('records a provider with no createTool without registering a tool (still inert)', () => {
    const { host } = createFakeHost();
    const registry = new PluginRegistry();
    const api = createCompatApi(host, registry) as Record<string, any>;
    api.registerWebSearchProvider({ id: 'plain' });
    expect(registry.getProviders('webSearch')).toHaveLength(1);
    expect(registry.tools.size).toBe(0);
  });

  it('skips a duplicate tool name rather than throwing', () => {
    const { host, logs } = createFakeHost();
    const registry = new PluginRegistry();
    const api = createCompatApi(host, registry) as Record<string, any>;
    const mk = () => ({ name: 'dupe', execute: async () => ({ content: [] }) });
    api.registerWebSearchProvider({ id: 'a', createTool: mk });
    expect(() => api.registerWebFetchProvider({ id: 'b', createTool: mk })).not.toThrow();
    expect(registry.tools.size).toBe(1);
    expect(logs.some((l) => /already registered/.test(l))).toBe(true);
  });
});

// ── Win #3 ──────────────────────────────────────────────────────────────────
describe('win #3: load defineBundledChannelEntry (webhook-mode)', () => {
  it('loads a bundled-channel plugin: records the channel + mounts its webhook route', async () => {
    const { host, mountedRoutes, routeHandlers, logs } = createFakeHost();
    const registry = new PluginRegistry();
    const api = createCompatApi(host, registry);

    const { id } = await loadPlugin(fixture('bundled-channel'), api);
    expect(id).toBe('fakechan');

    // Channel recorded (its Socket-Mode runtime specifier is NOT loaded).
    expect(registry.channels).toHaveLength(1);
    expect(registry.channels[0]).toMatchObject({ id: 'fakechan', name: 'Fake Channel' });

    // registerFull mounted a method-less route → POST, and used api.logger.
    expect(mountedRoutes).toEqual([{ method: 'POST', path: '/fakechan/webhook' }]);
    expect(logs.some((l) => /fakechan registerFull ran/.test(l))).toBe(true);

    const handler = routeHandlers.get('POST /fakechan/webhook')!;
    const res = (await handler({ method: 'POST', path: 'fakechan/webhook', headers: {}, body: { hello: 1 } })) as {
      status: number;
      body: unknown;
    };
    expect(res).toEqual({ status: 200, body: { ok: true, got: { hello: 1 } } });
  });

  it('applies a RAW bundled descriptor (no register) via the loader fallback', async () => {
    const { host, mountedRoutes, routeHandlers } = createFakeHost();
    const registry = new PluginRegistry();
    const api = createCompatApi(host, registry);

    const { id } = await loadPlugin(fixture('raw-bundled'), api);
    expect(id).toBe('rawchan');
    expect(registry.channels[0]).toMatchObject({ id: 'rawchan' });
    expect(mountedRoutes).toEqual([{ method: 'POST', path: '/rawchan/webhook' }]);
    const res = (await routeHandlers.get('POST /rawchan/webhook')!({
      method: 'POST',
      path: 'rawchan/webhook',
      headers: {},
      body: { z: 9 },
    })) as { status: number; body: unknown };
    expect(res).toEqual({ status: 202, body: { raw: true, got: { z: 9 } } });
  });
});

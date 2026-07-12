/**
 * Loads the REAL (vendored, unmodified) Tavily OpenClaw extension entry
 * (`../test/tavily/index.ts`) through `loadPlugin`'s `moduleOverrides`, and
 * runs its actual `register(api)` call sequence against this package's
 * compat `api` — proving the loader + api can carry a real extension, not
 * just the synthetic `echo-plugin` fixture in `loader.test.ts`. See
 * `org/docs/libs/openclaw-compat.md` § "Loading a real extension (Tavily) — proven".
 *
 * What's real: the entry file's source (verbatim from GitHub), the
 * `definePluginEntry` → `.register(api)` call sequence, `registerTool`'s
 * factory form, and `registerWebSearchProvider` recording.
 *
 * What's substituted: the SDK entry point (`openclaw/plugin-sdk/plugin-entry`
 * → `../src/plugin-sdk-shim.ts`, a faithful identity re-implementation) and
 * Tavily's own `./src/*` tool/provider factories (stubs — the real ones need
 * `@tavily/core`, unavailable without npm-registry egress in this sandbox).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createCompatApi } from './api.js';
import { loadPlugin } from './loader.js';
import * as pluginSdkShim from './plugin-sdk-shim.js';
import { PluginRegistry } from './registry.js';
import type { CompatHost, CompatRunAgentOptions } from './types.js';

// Stub modules standing in for Tavily's real `./src/*` factories (the real
// ones need `@tavily/core`, unavailable offline). See their header comments
// for exactly what they stand in for.
import * as tavilyExtractToolStub from '../test/tavily/src/tavily-extract-tool.js';
import * as tavilySearchProviderStub from '../test/tavily/src/tavily-search-provider.js';
import * as tavilySearchToolStub from '../test/tavily/src/tavily-search-tool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAVILY_FIXTURE_DIR = join(__dirname, '..', 'test', 'tavily');

function createFakeHost() {
  const mountedRoutes: Array<{ method: string; path: string }> = [];
  const runAgentCalls: CompatRunAgentOptions[] = [];
  const logs: string[] = [];

  const host: CompatHost = {
    async runAgent(opts) {
      runAgentCalls.push(opts);
      return { ok: true, result: `ran:${opts.message}` };
    },
    mountRoute(method, path) {
      mountedRoutes.push({ method, path });
    },
    log(msg) {
      logs.push(msg);
    },
  };

  return { host, mountedRoutes, runAgentCalls, logs };
}

describe('openclaw-compat: load a real vendored extension (Tavily)', () => {
  it('runs the real register(api) call sequence unmodified via moduleOverrides', async () => {
    const registry = new PluginRegistry();
    const { host, logs } = createFakeHost();
    const api = createCompatApi(host, registry);

    const moduleOverrides: Record<string, unknown> = {
      'openclaw/plugin-sdk/plugin-entry': pluginSdkShim,
      './src/tavily-search-tool.js': tavilySearchToolStub,
      './src/tavily-extract-tool.js': tavilyExtractToolStub,
      './src/tavily-search-provider.js': tavilySearchProviderStub,
    };

    const result = await loadPlugin(TAVILY_FIXTURE_DIR, api, { moduleOverrides });

    // `register(api)` ran to completion, no throw — the real Tavily entry's
    // full call sequence (registerWebSearchProvider + two factory-form
    // registerTool calls) succeeded against the compat api.
    expect(result).toEqual({ id: 'tavily' });

    // Both tools registered, factory-form (`(ctx) => tool`, `{ name }`).
    expect([...registry.tools.keys()].sort()).toEqual(['tavily_extract', 'tavily_search']);

    // The web-search provider registration was recorded.
    const webSearchProviders = registry.getProviders('webSearch');
    expect(webSearchProviders).toHaveLength(1);
    expect(webSearchProviders[0]!.provider).toMatchObject({ id: 'tavily' });
    expect(registry.providers).toHaveLength(1);

    // Invoking the registered factory-form tool proves the tool object built
    // by the factory (not just its shape) is what got wired through.
    const searchTool = registry.getTool('tavily_search');
    expect(searchTool).toBeDefined();
    const toolResult = await searchTool!.execute('call-1', { query: 'hi' });
    expect(toolResult).toEqual({ content: [{ type: 'text', text: 'stub:{"query":"hi"}' }] });

    const extractTool = registry.getTool('tavily_extract');
    expect(extractTool).toBeDefined();
    const extractResult = await extractTool!.execute('call-2', { urls: ['https://example.com'] });
    expect(extractResult).toEqual({
      content: [{ type: 'text', text: 'stub:{"urls":["https://example.com"]}' }],
    });

    // Sanity: the provider + tool registrations were logged through the host.
    expect(logs.some((l) => l.includes('registered webSearch provider "tavily"'))).toBe(true);
    expect(logs.some((l) => l.includes('registered tool "tavily_search"'))).toBe(true);
    expect(logs.some((l) => l.includes('registered tool "tavily_extract"'))).toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';

import { startLightpandaProxy, type ProxyDeps } from './lightpanda-proxy.js';

/** A spawned child that never errors — enough for the readiness loop. */
function fakeChild() {
  return { once: vi.fn(), kill: vi.fn() };
}

/**
 * An upstream that answers the readiness ping and echoes back a JSON-RPC result
 * for anything else, so a test can tell a ping from a proxied call.
 */
function fakeUpstream() {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = init?.body ?? '';
    calls.push(body);
    const isPing = body.includes('tools/list');
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(isPing ? { result: { tools: [] } } : { jsonrpc: '2.0', id: 7, result: { content: [{ text: 'hello page' }] } }),
    } as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function deps(over: Partial<ProxyDeps> = {}): ProxyDeps {
  return {
    env: { LIGHTPANDA_AUTO_INSTALL: '1' },
    spawn: vi.fn(() => fakeChild()) as unknown as ProxyDeps['spawn'],
    exists: () => false,
    sleep: async () => {},
    install: vi.fn(async () => ({ ok: true, path: '/cache/lightpanda' })) as unknown as ProxyDeps['install'],
    ...over,
  };
}

describe('startLightpandaProxy', () => {
  // The entire reason the shim exists: a bundle must not pay 156 MB for a run
  // that never browses.
  it('installs and spawns nothing until a call arrives', async () => {
    const install = vi.fn(async () => ({ ok: true, path: '/cache/lightpanda' }));
    const spawn = vi.fn(() => fakeChild());
    const proxy = await startLightpandaProxy(
      deps({ install: install as unknown as ProxyDeps['install'], spawn: spawn as unknown as ProxyDeps['spawn'], ...fakeUpstream() }),
    );
    try {
      expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(install).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });

  it('installs, starts the browser and proxies the first call', async () => {
    const upstream = fakeUpstream();
    const install = vi.fn(async () => ({ ok: true, path: '/cache/lightpanda' }));
    const spawn = vi.fn(() => fakeChild());
    const proxy = await startLightpandaProxy(
      deps({ install: install as unknown as ProxyDeps['install'], spawn: spawn as unknown as ProxyDeps['spawn'], fetchImpl: upstream.fetchImpl }),
    );
    try {
      const res = await fetch(proxy.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'goto' } }),
      });
      const json = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };

      expect(res.status).toBe(200);
      expect(json.result?.content?.[0]?.text).toBe('hello page');
      expect(install).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect((spawn.mock.calls as unknown as unknown[][])[0]![0]).toBe('/cache/lightpanda');
      // A readiness ping, then the real call forwarded verbatim.
      expect(upstream.calls.some((c) => c.includes('tools/list'))).toBe(true);
      expect(upstream.calls.some((c) => c.includes('tools/call'))).toBe(true);
    } finally {
      await proxy.close();
    }
  });

  it('installs only once across concurrent calls', async () => {
    const install = vi.fn(async () => ({ ok: true, path: '/cache/lightpanda' }));
    const proxy = await startLightpandaProxy(
      deps({ install: install as unknown as ProxyDeps['install'], ...fakeUpstream() }),
    );
    try {
      const call = () =>
        fetch(proxy.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
        });
      await Promise.all([call(), call(), call()]);
      expect(install).toHaveBeenCalledTimes(1);
    } finally {
      await proxy.close();
    }
  });

  /**
   * The failure shape is the point. `system-browser`'s wrappers surface
   * `rpc.error.message` verbatim but flatten any non-2xx into "returned HTTP
   * 503" — which would tell the agent a server rejected its call, when the truth
   * is that a download failed.
   */
  it('reports a failed install as a JSON-RPC error on a 200, carrying the cause', async () => {
    const proxy = await startLightpandaProxy(
      deps({
        install: vi.fn(async () => ({ ok: false, reason: 'download failed: HTTP 403 Forbidden' })) as unknown as ProxyDeps['install'],
        ...fakeUpstream(),
      }),
    );
    try {
      const res = await fetch(proxy.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/call' }),
      });
      const json = (await res.json()) as { id?: unknown; error?: { message?: string } };

      expect(res.status).toBe(200);
      expect(json.id).toBe(42);
      expect(json.error?.message).toContain('HTTP 403');
      expect(json.error?.message).toContain('browsing is unavailable');
    } finally {
      await proxy.close();
    }
  });

  it('refuses to install when explicitly opted out, and names the remedy', async () => {
    const install = vi.fn();
    const proxy = await startLightpandaProxy(
      deps({ env: { LIGHTPANDA_AUTO_INSTALL: '0' }, install: install as unknown as ProxyDeps['install'], ...fakeUpstream() }),
    );
    try {
      const res = await fetch(proxy.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      expect(json.error?.message).toMatch(/lmthing browser install/);
      expect(install).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });

  // Someone curling the endpoint to see whether it is alive must not trigger a
  // 156 MB download as a side effect of asking.
  it('answers a GET without starting anything', async () => {
    const install = vi.fn();
    const proxy = await startLightpandaProxy(
      deps({ install: install as unknown as ProxyDeps['install'], ...fakeUpstream() }),
    );
    try {
      const res = await fetch(proxy.url);
      const json = (await res.json()) as { browser?: string };
      expect(res.status).toBe(200);
      expect(json.browser).toMatch(/not started/);
      expect(install).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });
});

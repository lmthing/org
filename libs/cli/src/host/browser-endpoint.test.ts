import { describe, it, expect, afterEach } from 'vitest';
import { startBrowserEndpoint, type BrowserEndpoint } from './browser-endpoint.js';
import { HostBridge, type HostSocket } from '../rpc/host-bridge.js';

function fakeSocket() {
  const sent: Array<Record<string, unknown>> = [];
  const sock: HostSocket & { sent: typeof sent } = {
    readyState: 1,
    send: (d: string) => sent.push(JSON.parse(d)),
    close: () => {},
    sent,
  };
  return sock;
}

let endpoint: BrowserEndpoint | undefined;
afterEach(async () => {
  await endpoint?.close();
  endpoint = undefined;
});

describe('the loopback browser endpoint', () => {
  it('publishes LIGHTPANDA_MCP_URL, which is the whole reason the 27 functions need no changes', async () => {
    const bridge = new HostBridge();
    endpoint = await startBrowserEndpoint(bridge);
    // The wrappers read this variable and nothing else; `process.env` is snapshot-copied into each
    // QuickJS VM at injection time, so setting it here is the entire integration.
    expect(process.env['LIGHTPANDA_MCP_URL']).toBe(endpoint.url);
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('forwards the tools/call body VERBATIM and returns the desktop’s answer', async () => {
    const bridge = new HostBridge();
    const sock = fakeSocket();
    bridge.attach(sock);
    endpoint = await startBrowserEndpoint(bridge);

    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'goto', arguments: { url: 'https://example.test' } } };
    const pending = fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpc),
    });

    // The desktop sees exactly what the agent sent — no re-encoding, no field renaming. Anything
    // else would be a second tool catalog to keep in sync with Lightpanda's.
    await vi_waitFor(() => sock.sent.length >= 2);
    const forwarded = sock.sent.find((m) => m['type'] === 'browser.request') as { id: string; body: unknown };
    expect(forwarded.body).toEqual(rpc);

    bridge.handleMessage(
      JSON.stringify({
        type: 'result',
        id: forwarded.id,
        ok: true,
        value: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'loaded' }] } },
      }),
    );

    const body = (await (await pending).json()) as { result?: { content?: Array<{ text?: string }> } };
    expect(body.result?.content?.[0]?.text).toBe('loaded');
  });

  it('reports "no desktop" as a JSON-RPC error the AGENT can read, not an HTTP failure', async () => {
    // The wrappers surface `rpc.error.message` to the model. An HTTP 500 would reach it as
    // "lightpanda MCP returned HTTP 500", which tells the model nothing it can act on.
    const bridge = new HostBridge();
    endpoint = await startBrowserEndpoint(bridge);

    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'goto' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; error: { message: string } };
    expect(body.id).toBe(7);
    expect(body.error.message).toMatch(/No LMThing desktop is connected/);
  });

  it('answers malformed JSON with a parse error rather than hanging', async () => {
    const bridge = new HostBridge();
    endpoint = await startBrowserEndpoint(bridge);
    const res = await fetch(endpoint.url, { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('unpublishes the variable on close, so a stale endpoint cannot capture later VMs', async () => {
    const bridge = new HostBridge();
    const e = await startBrowserEndpoint(bridge);
    expect(process.env['LIGHTPANDA_MCP_URL']).toBe(e.url);
    await e.close();
    expect(process.env['LIGHTPANDA_MCP_URL']).toBeUndefined();
  });
});

/** Minimal poll — the forward happens on the server's own tick, not on ours. */
async function vi_waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}

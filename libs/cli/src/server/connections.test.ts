import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionResolver, SUPPORTED_CONNECTION_PROVIDERS } from './connections.js';

/**
 * Unit tests for the pod-side connection resolver (BRING-YOUR-OWN-TOKEN): it
 * reads the user's OWN provider token from the pod env, host-pins the request to
 * the provider apiBase, and calls the provider DIRECTLY. No gateway broker.
 * `fetch` is mocked so no network is touched.
 */

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const ORIG_ENV = { ...process.env };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let calls: Array<{ url: string; init?: RequestInit }>;

function installFetch(impl: FetchImpl) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  }));
}

beforeEach(() => {
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GOOGLE_ACCESS_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIG_ENV };
});

describe('createConnectionResolver (BYO)', () => {
  it('supports slack/github/google', () => {
    expect(SUPPORTED_CONNECTION_PROVIDERS).toEqual(expect.arrayContaining(['slack', 'github', 'google']));
  });

  it('reads the user token from env and calls the provider directly with it', async () => {
    process.env.GOOGLE_ACCESS_TOKEN = 'user-google-token';
    installFetch(async (url) => {
      if (url.startsWith('https://www.googleapis.com/gmail/v1/users/me/messages')) {
        return jsonResponse(200, { messages: [{ id: 'm1' }] });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const resolve = createConnectionResolver()!;
    const out = await resolve('google', { method: 'GET', path: '/gmail/v1/users/me/messages', query: { maxResults: '5' } });

    expect(out).toEqual({ ok: true, status: 200, data: { messages: [{ id: 'm1' }] } });
    // Exactly ONE call — straight to the provider, no gateway token mint.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=5');
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer user-google-token');
  });

  it('host-pins slack to slack.com/api and sends a JSON body', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-123';
    installFetch(async () => jsonResponse(200, { ok: true, ts: '1699.1' }));
    const resolve = createConnectionResolver()!;
    const out = await resolve('slack', {
      method: 'POST',
      path: '/chat.postMessage',
      body: { channel: 'C1', text: 'hi', thread_ts: '1699.0' },
    });
    expect(out).toEqual({ ok: true, status: 200, data: { ok: true, ts: '1699.1' } });
    expect(calls[0]!.url).toBe('https://slack.com/api/chat.postMessage');
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-123');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ channel: 'C1', text: 'hi', thread_ts: '1699.0' });
  });

  it('throws "not configured" when the provider token env is unset', async () => {
    installFetch(async () => jsonResponse(200, {}));
    const resolve = createConnectionResolver()!;
    await expect(resolve('slack', { method: 'GET', path: '/auth.test' })).rejects.toThrow(
      /not configured — set SLACK_BOT_TOKEN in Settings → Integrations/,
    );
    expect(calls).toHaveLength(0); // never hit the network
  });

  it('throws for an unknown provider', async () => {
    const resolve = createConnectionResolver()!;
    await expect(resolve('dropbox', { method: 'GET', path: '/x' })).rejects.toThrow(/unknown provider/);
  });

  it('rejects an absolute path (host-pinning) without calling the provider', async () => {
    process.env.GOOGLE_ACCESS_TOKEN = 'user-google-token';
    installFetch(async () => {
      throw new Error('provider must not be called for an absolute path');
    });
    const resolve = createConnectionResolver()!;
    await expect(resolve('google', { method: 'GET', path: 'https://evil.example/steal' })).rejects.toThrow(
      /relative to the provider apiBase/,
    );
    expect(calls).toHaveLength(0);
  });

  it('surfaces a provider error status/body in the response (does not throw)', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-123';
    installFetch(async () => jsonResponse(200, { ok: false, error: 'not_in_channel' }));
    const resolve = createConnectionResolver()!;
    const out = await resolve('slack', { method: 'POST', path: '/chat.postMessage', body: { channel: 'C', text: 'x' } });
    expect(out).toEqual({ ok: true, status: 200, data: { ok: false, error: 'not_in_channel' } });
  });
});

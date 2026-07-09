import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionResolver } from './connections.js';

/**
 * Unit tests for the pod-side connection resolver: it mints a short-lived access
 * token from the gateway, makes the provider REST call DIRECTLY (host-pinned to
 * the returned apiBase), caches the token, and on a 401 forces a refresh + retry.
 * `fetch` is mocked so no network is touched.
 */

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const GATEWAY = 'http://gw.test';
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
  process.env.LMTHING_CONNECTIONS_JWT = 'pod-jwt';
  process.env.LMTHING_GATEWAY_URL = GATEWAY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIG_ENV };
});

describe('createConnectionResolver', () => {
  it('returns undefined when LMTHING_CONNECTIONS_JWT is unset', () => {
    delete process.env.LMTHING_CONNECTIONS_JWT;
    expect(createConnectionResolver()).toBeUndefined();
  });

  it('mints a token from the gateway, then calls the provider directly with it', async () => {
    installFetch(async (url) => {
      if (url.startsWith(`${GATEWAY}/api/connections/google/token`)) {
        return jsonResponse(200, {
          accessToken: 'AT-1',
          apiBase: 'https://www.googleapis.com',
          expiresAt: Date.now() + 3600_000,
        });
      }
      if (url.startsWith('https://www.googleapis.com/gmail/v1/users/me/messages')) {
        return jsonResponse(200, { messages: [{ id: 'm1' }] });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const resolve = createConnectionResolver()!;
    const out = await resolve('google', { method: 'GET', path: '/gmail/v1/users/me/messages', query: { maxResults: '5' } });

    expect(out).toEqual({ ok: true, status: 200, data: { messages: [{ id: 'm1' }] } });
    // First call = gateway token mint (with the pod JWT), second = direct provider call.
    expect(calls[0]!.url).toBe(`${GATEWAY}/api/connections/google/token`);
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer pod-jwt');
    expect(calls[1]!.url).toBe('https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=5');
    expect((calls[1]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer AT-1');
  });

  it('caches the access token across calls (one mint, two provider calls)', async () => {
    let mints = 0;
    installFetch(async (url) => {
      if (url.includes('/api/connections/slack/token')) {
        mints += 1;
        return jsonResponse(200, { accessToken: 'AT', apiBase: 'https://slack.com/api', expiresAt: Date.now() + 3600_000 });
      }
      return jsonResponse(200, { ok: true });
    });
    const resolve = createConnectionResolver()!;
    await resolve('slack', { method: 'POST', path: '/chat.postMessage', body: { channel: 'C', text: 'hi' } });
    await resolve('slack', { method: 'GET', path: '/conversations.list' });
    expect(mints).toBe(1);
  });

  it('on a provider 401 forces a fresh token and retries once', async () => {
    let mints = 0;
    let providerHits = 0;
    installFetch(async (url) => {
      if (url.includes('/api/connections/github/token')) {
        mints += 1;
        return jsonResponse(200, { accessToken: `AT-${mints}`, apiBase: 'https://api.github.com', expiresAt: Date.now() + 3600_000 });
      }
      providerHits += 1;
      // First provider hit → 401 (stale token); second (after force refresh) → 200.
      return providerHits === 1 ? jsonResponse(401, { message: 'Bad credentials' }) : jsonResponse(200, { login: 'octocat' });
    });
    const resolve = createConnectionResolver()!;
    const out = await resolve('github', { method: 'GET', path: '/user' });
    expect(out).toEqual({ ok: true, status: 200, data: { login: 'octocat' } });
    expect(mints).toBe(2); // initial + forced refresh
    expect(providerHits).toBe(2); // original + retry
    // The forced re-mint asked the gateway to refresh.
    const refreshCall = calls.find((c) => c.url.includes('/github/token') && JSON.parse(String(c.init!.body)).refresh === true);
    expect(refreshCall).toBeTruthy();
  });

  it('rejects an absolute path (host-pinning) without calling the provider', async () => {
    installFetch(async (url) => {
      if (url.includes('/token')) return jsonResponse(200, { accessToken: 'AT', apiBase: 'https://www.googleapis.com', expiresAt: null });
      throw new Error('provider must not be called for an absolute path');
    });
    const resolve = createConnectionResolver()!;
    await expect(resolve('google', { method: 'GET', path: 'https://evil.example/steal' })).rejects.toThrow(/relative to the provider apiBase/);
  });

  it('surfaces a gateway error (e.g. not connected) as a thrown error', async () => {
    installFetch(async () => jsonResponse(409, { error: 'Google not connected' }));
    const resolve = createConnectionResolver()!;
    await expect(resolve('google', { method: 'GET', path: '/x' })).rejects.toThrow(/Google not connected/);
  });
});

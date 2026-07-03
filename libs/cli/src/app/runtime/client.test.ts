/**
 * `@app/runtime` client — api-base resolution + method-aware request assembly.
 *
 * Pure/browser code: we stub `window.location`, `fetch` and the injected
 * `window.__APP_ENDPOINTS__` manifest (no jsdom needed) and assert `apiCall`
 * fires the right method/URL/body for a given `…/app/<project>` prefix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiCall, buildRequest, HttpError, resolveAppBase } from './client.js';

const MANIFEST = {
  feedList: { method: 'GET', routePath: '/feed-list' },
  getItem: { method: 'GET', routePath: '/items/:id' },
  markRead: { method: 'POST', routePath: '/mark-read' },
  updateItem: { method: 'PATCH', routePath: '/items/:id' },
  home: { method: 'GET', routePath: '/' },
} as const;

function setLocation(pathname: string): void {
  vi.stubGlobal('window', { location: { pathname } });
  vi.stubGlobal('__APP_ENDPOINTS__', MANIFEST);
  (globalThis as { __APP_ENDPOINTS__?: unknown }).__APP_ENDPOINTS__ = MANIFEST;
}

function mockFetch(status = 200, body: unknown = { ok: true }): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __APP_ENDPOINTS__?: unknown; __APP_BASE__?: unknown }).__APP_ENDPOINTS__;
  delete (globalThis as { __APP_BASE__?: unknown }).__APP_BASE__;
});

describe('resolveAppBase', () => {
  it('extracts the …/app/<project> prefix from a nested pathname', () => {
    expect(resolveAppBase('/app/feed/items/5')).toBe('/app/feed');
    expect(resolveAppBase('/app/feed')).toBe('/app/feed');
    expect(resolveAppBase('/studio/app/feed/stats')).toBe('/studio/app/feed');
  });

  it('returns "" when there is no /app/<project> prefix', () => {
    expect(resolveAppBase('/feed/items/5')).toBe('');
  });

  it('honours a window.__APP_BASE__ / explicit override (the /app-stripped host)', () => {
    expect(resolveAppBase('/feed/items/5', '/feed')).toBe('/feed');
    (globalThis as { __APP_BASE__?: string }).__APP_BASE__ = '/feed/';
    expect(resolveAppBase('/feed/items/5')).toBe('/feed');
    delete (globalThis as { __APP_BASE__?: string }).__APP_BASE__;
  });
});

describe('buildRequest', () => {
  it('GET with a path param → base/api path, no body', () => {
    const r = buildRequest(MANIFEST.getItem, { id: '5' }, '/app/feed');
    expect(r).toMatchObject({ method: 'GET', url: '/app/feed/api/items/5' });
    expect(r.init.body).toBeUndefined();
  });

  it('GET routes non-path input to the query string', () => {
    const r = buildRequest(MANIFEST.feedList, { unreadOnly: true, page: 2 }, '/app/feed');
    expect(r.url).toBe('/app/feed/api/feed-list?unreadOnly=true&page=2');
  });

  it('root route → base/api (no trailing slash)', () => {
    const r = buildRequest(MANIFEST.home, {}, '/app/feed');
    expect(r.url).toBe('/app/feed/api');
  });

  it('POST puts the non-path remainder in a JSON body', () => {
    const r = buildRequest(MANIFEST.markRead, { id: 7, seen: true }, '/app/feed');
    expect(r).toMatchObject({ method: 'POST', url: '/app/feed/api/mark-read' });
    expect(JSON.parse(r.init.body as string)).toEqual({ id: 7, seen: true });
  });

  it('PATCH consumes the path param, bodies only the rest', () => {
    const r = buildRequest(MANIFEST.updateItem, { id: '9', title: 'hi' }, '/app/feed');
    expect(r.url).toBe('/app/feed/api/items/9');
    expect(JSON.parse(r.init.body as string)).toEqual({ title: 'hi' });
  });
});

describe('apiCall', () => {
  it('resolves the base from window.location and fetches the right URL', async () => {
    setLocation('/app/feed/items/5');
    const fetchFn = mockFetch(200, { id: '5', title: 'x' });
    const out = await apiCall('getItem', { id: '5' });
    expect(out).toEqual({ id: '5', title: 'x' });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/app/feed/api/items/5');
    expect(init.method).toBe('GET');
  });

  it('throws the { error } contract as an HttpError on non-2xx', async () => {
    setLocation('/app/feed/');
    mockFetch(404, { error: { status: 404, message: 'not found', details: { id: 'x' } } });
    await expect(apiCall('getItem', { id: 'x' })).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
      message: 'not found',
      details: { id: 'x' },
    });
  });

  it('throws for an unknown endpoint name', async () => {
    setLocation('/app/feed/');
    mockFetch();
    await expect(apiCall('nope')).rejects.toBeInstanceOf(HttpError);
  });
});

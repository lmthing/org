import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchResilient, Pod } from './pod.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** The exact shape undici throws when the connect times out (what actually killed a live run). */
const connectTimeout = () => {
  const cause = new Error('Connect Timeout Error (attempted address: lmthing.chat:443, timeout: 10000ms)');
  cause.code = 'UND_ERR_CONNECT_TIMEOUT';
  return Object.assign(new TypeError('fetch failed'), { cause });
};

const ok = () => new Response('{}', { status: 200 });

describe('fetchResilient', () => {
  it('retries a transient connect timeout instead of propagating it', async () => {
    // Before the fix this rejected on the first call: a `TypeError: fetch failed` is not an HTTP
    // status, so it slipped past every {waking:true}/504 retry and killed the whole scenario run.
    const fetchMock = vi.fn().mockRejectedValueOnce(connectTimeout()).mockResolvedValueOnce(ok());
    globalThis.fetch = fetchMock;

    const res = await fetchResilient('https://lmthing.chat/api/sessions', {}, { waitMs: 0 });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ECONNRESET', Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })],
    ['socket hang up', new Error('socket hang up')],
    ['DNS EAI_AGAIN', Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } })],
    ['terminated', new TypeError('terminated')],
  ])('retries a transient %s', async (_label, err) => {
    const fetchMock = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(ok());
    globalThis.fetch = fetchMock;

    await expect(fetchResilient('https://lmthing.chat/api/x', {}, { waitMs: 0 })).resolves.toMatchObject({
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rethrows a non-transient error immediately — a real bug must not be retried away', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Invalid URL'));
    globalThis.fetch = fetchMock;

    await expect(fetchResilient('not-a-url', {}, { waitMs: 0 })).rejects.toThrow('Invalid URL');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget rather than looping forever', async () => {
    const fetchMock = vi.fn().mockRejectedValue(connectTimeout());
    globalThis.fetch = fetchMock;

    await expect(
      fetchResilient('https://lmthing.chat/api/x', {}, { tries: 3, waitMs: 0 }),
    ).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(4); // the initial attempt + 3 retries
  });

  it('passes an HTTP error response straight through (status handling is the caller’s job)', async () => {
    // A 500 is a real verdict, not a transport fault — fetchResilient must not swallow or retry it.
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    globalThis.fetch = fetchMock;

    const res = await fetchResilient('https://lmthing.chat/api/x', {}, { waitMs: 0 });

    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Pod — env write + hook/emitter payload passthrough', () => {
  /** Capture the exact url/method/body of the NEXT fetch call, always answering 200 {}. */
  function mockFetchJson() {
    let seen;
    globalThis.fetch = vi.fn(async (url, init) => {
      seen = { url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    return () => seen;
  }

  it('putEnv PUTs {content} to /api/env — the whole-file-replace route', async () => {
    const lastCall = mockFetchJson();
    const pod = new Pod({ base: 'http://x' });
    await pod.putEnv('KEY=value\n');
    expect(lastCall()).toEqual({ url: 'http://x/api/env', method: 'PUT', body: { content: 'KEY=value\n' } });
  });

  it('runHook forwards an optional payload as the POST body (defaults to {})', async () => {
    const lastCall = mockFetchJson();
    const pod = new Pod({ base: 'http://x' });

    await pod.runHook('proj', 'weekly-reconcile');
    expect(lastCall()).toEqual({ url: 'http://x/api/projects/proj/hooks/weekly-reconcile/run', method: 'POST', body: {} });

    await pod.runHook('proj', 'weekly-reconcile', { forced: true });
    expect(lastCall().body).toEqual({ forced: true });
  });

  it('runEmitter builds the @emitter:scope:name pseudo-slug and forwards a payload', async () => {
    const lastCall = mockFetchJson();
    const pod = new Pod({ base: 'http://x' });

    await pod.runEmitter('proj', 'household', 'weekly_plan', { forced: true });
    expect(lastCall().url).toBe(`http://x/api/projects/proj/hooks/${encodeURIComponent('@emitter:household:weekly_plan')}/run`);
    expect(lastCall().body).toEqual({ forced: true });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchResilient } from './pod.mjs';

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

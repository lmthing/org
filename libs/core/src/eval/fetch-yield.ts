import type { FetchOpts, FetchResult } from '../globals/fetch.js';

/**
 * Resolve a `fetch` yield with a real, non-blocking Node `fetch()` call —
 * shared by the session/delegate yield router and the fork leaf VM's own
 * yield handler. Bounded by a hard timeout so a hung endpoint can't stall a
 * turn forever (mirrors the old curl `--connect-timeout`/`--max-time` bound).
 */
export async function resolveFetchYield(url: string, opts: FetchOpts | undefined): Promise<FetchResult> {
  try {
    const response = await globalThis.fetch(url, {
      method: opts?.method ?? 'GET',
      headers: opts?.headers,
      body: opts?.body,
      signal: AbortSignal.timeout(25_000),
    });
    // Buffer once; `text()`/`json()` on the real Response are themselves async,
    // but callers (webSearch/webFetch) expect the same sync-accessor shape the
    // old curl-backed fetch returned.
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text: () => text,
      json: () => JSON.parse(text),
    };
  } catch {
    return { ok: false, status: 0, text: () => '', json: () => ({}) };
  }
}

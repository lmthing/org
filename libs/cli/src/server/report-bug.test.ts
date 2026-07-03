/**
 * Pod-side bug-report broker — offline, deterministic.
 *
 * `fetch` is stubbed so no gateway/GitHub is contacted. Proves:
 *   - a missing session → 404, no gateway call;
 *   - the session trace is forwarded as NDJSON (one bare TraceEvent per line,
 *     the format the chat TraceLoader/parseTrace round-trips);
 *   - the caller's Authorization header + screenshot are forwarded verbatim;
 *   - the gateway's JSON response (and status) is relayed as-is;
 *   - a transport error surfaces as 502 rather than throwing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { reportBug } from './report-bug.js';
import type { ServerContext } from './router.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** A ServerContext whose manager returns a session with the given trace events. */
function ctxWith(events: Array<{ seq: number; event: unknown }> | null): ServerContext {
  const manager = {
    getSession: (_id: string) =>
      events === null ? undefined : { hub: { snapshot: () => ({ events, lastSeq: 0, truncatedBefore: 0 }) } },
  };
  return { manager } as unknown as ServerContext;
}

describe('reportBug', () => {
  it('returns 404 and does not call the gateway when the session is missing', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await reportBug({
      sessionId: 'nope',
      title: 't',
      message: 'm',
      authHeader: 'Bearer x',
      ctx: ctxWith(null),
    });

    expect(out.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the trace as NDJSON, the auth header and screenshot, and relays the response', async () => {
    const events = [
      { seq: 1, event: { type: 'session_start', sessionId: 's1' } },
      { seq: 2, event: { type: 'user_message', text: 'hi' } },
    ];
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(
        new Response(JSON.stringify({ url: 'https://github.com/lmthing/org/issues/7', number: 7 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    const out = await reportBug({
      sessionId: 's1',
      title: 'Bug',
      message: 'It broke',
      screenshot: 'data:image/png;base64,AAAA',
      authHeader: 'Bearer tok-123',
      ctx: ctxWith(events),
    });

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ url: 'https://github.com/lmthing/org/issues/7', number: 7 });

    expect(captured).not.toBeNull();
    const { url, init } = captured!;
    expect(url).toMatch(/\/api\/issues$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');

    const sent = JSON.parse(init.body as string) as { title: string; message: string; trace: string; screenshot?: string };
    expect(sent.title).toBe('Bug');
    expect(sent.screenshot).toBe('data:image/png;base64,AAAA');
    // NDJSON: one JSON object per line, each a bare TraceEvent (no seq wrapper).
    const lines = sent.trace.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ type: 'session_start', sessionId: 's1' });
    expect(JSON.parse(lines[1])).toEqual({ type: 'user_message', text: 'hi' });
  });

  it('omits the Authorization header when none is provided', async () => {
    let headers: Record<string, string> = {};
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    await reportBug({ sessionId: 's1', title: 't', message: 'm', authHeader: undefined, ctx: ctxWith([]) });
    expect(headers.Authorization).toBeUndefined();
  });

  it('surfaces a transport failure as 502 instead of throwing', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('econnrefused'))) as unknown as typeof fetch;

    const out = await reportBug({ sessionId: 's1', title: 't', message: 'm', authHeader: 'Bearer x', ctx: ctxWith([]) });
    expect(out.status).toBe(502);
    expect((out.body as { error: string }).error).toMatch(/econnrefused/);
  });
});

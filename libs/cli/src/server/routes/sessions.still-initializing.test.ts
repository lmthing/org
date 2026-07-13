/**
 * Regression: a message POSTed to a STILL-INITIALIZING (resuming) session must not crash the pod.
 *
 * `POST /api/sessions/:id/message` is fire-and-forget — it returns 202 while the turn runs. But
 * `SessionManager.sendMessage` can REJECT before the run promise exists: a message that lands while
 * the session is still initializing/resuming throws "still initializing", and attachment assembly
 * can fail. The HTTP handler used to drop that promise, so the rejection became an
 * `unhandledRejection` that crashed the whole pod process — and because the client retries the same
 * message, it CRASHLOOPED the pod (observed live in scenario 08-small-shop on a post-restart auto-
 * resume). The fix routes the rejection to the session's error stream, exactly like the WS path.
 */
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleSessionSubRoute } from './sessions.js';

function fakeReq(body: string): IncomingMessage {
  const r = Readable.from([Buffer.from(body, 'utf8')]) as unknown as IncomingMessage;
  r.method = 'POST';
  r.url = '/api/sessions/sess-1/message';
  return r;
}

function fakeRes(): { res: ServerResponse; status: () => number | undefined } {
  let status: number | undefined;
  const res = {
    writeHead(s: number) { status = s; return this; },
    setHeader() {},
    end() {},
  } as unknown as ServerResponse;
  return { res, status: () => status };
}

describe('POST /message to a still-initializing session', () => {
  it('does not throw / crash and routes the rejection to the session error stream (202)', async () => {
    const emitted: Array<{ type: string; message?: string }> = [];
    const entry = {
      hub: {},
      spaceDir: 'x',
      agentSlug: 'thing',
      renderHost: {
        emit: (e: { type: string; message?: string }) => emitted.push(e),
        submitForm: () => {},
        cancelAsk: () => {},
        pendingAsks: () => [],
      },
    };
    let sendCalls = 0;
    const ctx = {
      manager: {
        getSession: () => entry,
        // Reproduce the real pre-run throw: sendMessage rejects synchronously-in-async.
        sendMessage: async () => {
          sendCalls++;
          throw new Error('session "sess-1" is still initializing — retry in a moment');
        },
      },
      broadcastUiControl: () => () => {},
    } as unknown as Parameters<typeof handleSessionSubRoute>[3];

    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { res, status } = fakeRes();
      // Must resolve without throwing.
      await expect(
        handleSessionSubRoute(fakeReq(JSON.stringify({ content: 'you back?' })), res, { id: 'sess-1', rest: 'message' }, ctx),
      ).resolves.toBeUndefined();
      expect(status()).toBe(202); // fire-and-forget accepted
      expect(sendCalls).toBe(1);
      // Let the fire-and-forget `.catch` microtask run.
      await new Promise((r) => setTimeout(r, 10));
      // The rejection was routed to the session's error stream, NOT dropped.
      expect(emitted.some((e) => e.type === 'error' && /still initializing/.test(e.message ?? ''))).toBe(true);
      // The crux: no unhandledRejection escaped to crash the process.
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

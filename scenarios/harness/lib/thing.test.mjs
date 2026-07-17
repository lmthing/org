import { describe, expect, it, vi } from 'vitest';
import { ThingSession, CANCEL_ASK } from './thing.mjs';

/**
 * A minimal in-memory fake pod. `ThingSession` only ever calls `pod.req(method, path, body)` (and
 * `pod.base`/`pod.token` inside `sendWithAttachments`'s WS path, unused here) — see thing.mjs's own
 * header comment for the exact HTTP surface this mirrors.
 */
class FakePod {
  constructor() {
    this.calls = [];
    this.sessionId = 's1';
    this.askId = 'ask-1';
    this.askOpen = true;
    this._emitted = false;
  }
  async req(method, path) {
    this.calls.push({ method, path });
    if (method === 'POST' && path === '/api/sessions') return { sessionId: this.sessionId };
    if (method === 'GET' && path.startsWith(`/api/sessions/${this.sessionId}/events`)) {
      if (!this._emitted) {
        this._emitted = true;
        return { events: [{ seq: 1, event: { type: 'display', descriptor: { props: { text: 'hi' } } } }], lastSeq: 1 };
      }
      return { events: [], lastSeq: 1 };
    }
    if (method === 'GET' && path === `/api/sessions/${this.sessionId}/asks?format=json`) {
      return { asks: this.askOpen ? [{ id: this.askId, descriptor: { type: 'Ask', prompt: 'which one?' } }] : [] };
    }
    if (method === 'POST' && path === `/api/sessions/${this.sessionId}/message`) return { ok: true };
    if (method === 'POST' && path === `/api/sessions/${this.sessionId}/ask/${this.askId}`) {
      this.askOpen = false;
      return { ok: true };
    }
    if (method === 'DELETE' && path === `/api/sessions/${this.sessionId}/ask/${this.askId}`) {
      this.askOpen = false;
      return { ok: true };
    }
    if (method === 'GET' && path === '/api/sessions') {
      return { sessions: [{ sessionId: this.sessionId, status: 'idle' }] };
    }
    throw new Error(`FakePod: unhandled ${method} ${path}`);
  }
}

describe('ThingSession.cancelAsk', () => {
  it('DELETEs the ask endpoint (not a POST) — true-cancel fidelity', async () => {
    const pod = new FakePod();
    const sess = new ThingSession(pod);
    sess.sessionId = pod.sessionId;
    await sess.cancelAsk(pod.askId);
    expect(pod.calls.at(-1)).toEqual({ method: 'DELETE', path: '/api/sessions/s1/ask/ask-1' });
  });
});

describe('the ask-draining loop routes CANCEL_ASK to DELETE, a normal value to POST', () => {
  it('calls cancelAsk (DELETE) when onAsk returns the CANCEL_ASK sentinel', async () => {
    const pod = new FakePod();
    const onAsk = vi.fn().mockReturnValue(CANCEL_ASK);
    const sess = new ThingSession(pod, { onAsk });
    await sess.start();
    const turn = await sess.send('hello');

    expect(turn.lastText).toBe('hi');
    const askCalls = pod.calls.filter((c) => c.path.includes('/ask/'));
    expect(askCalls).toEqual([{ method: 'DELETE', path: '/api/sessions/s1/ask/ask-1' }]);
  }, 15000);

  it('calls answerAsk (POST) when onAsk returns a normal value', async () => {
    const pod = new FakePod();
    const onAsk = vi.fn().mockReturnValue('an answer');
    const sess = new ThingSession(pod, { onAsk });
    await sess.start();
    await sess.send('hello');

    const askCalls = pod.calls.filter((c) => c.path.includes('/ask/'));
    expect(askCalls).toEqual([{ method: 'POST', path: '/api/sessions/s1/ask/ask-1' }]);
  }, 15000);
});

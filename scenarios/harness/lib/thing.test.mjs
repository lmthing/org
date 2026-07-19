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

// The 07-life-admin false-vanish fix: `#dispatchAndWait` used to throw "vanished" the INSTANT it
// saw a single missed signal (a 404 on the events poll, or one `GET /api/sessions` response that
// happened not to list the id) — even though a legitimately slow build (scenario 07's
// `automator#build_live_project`, ~18min/~1.7M input tokens) stayed LISTED and working the entire
// time. These pin: a session that blips once but stays alive+working does NOT throw; a session that
// is genuinely, persistently gone still throws the honest error (C1's design, preserved).
describe('ThingSession — suspected vs. confirmed "vanished" (scenario 07 false-vanish fix)', () => {
  /** Simulates a single transient 404 on the events poll (the `sessionGone` path) while the
   *  session stays LISTED (and, briefly, `running`) the whole time — the slow-but-alive shape. */
  class BlipsThenAliveFakePod {
    constructor() {
      this.sessionId = 's1';
      this.eventsCall = 0;
      this.listCall = 0;
    }
    async req(method, path) {
      if (method === 'POST' && path === '/api/sessions') return { sessionId: this.sessionId };
      if (method === 'POST' && path === `/api/sessions/${this.sessionId}/message`) return { ok: true };
      if (method === 'GET' && path === `/api/sessions/${this.sessionId}/asks?format=json`) return { asks: [] };
      if (method === 'GET' && path.startsWith(`/api/sessions/${this.sessionId}/events`)) {
        this.eventsCall++;
        if (this.eventsCall === 1) {
          return {
            events: [{ seq: 1, event: { type: 'display', descriptor: { props: { text: 'working' } } } }],
            lastSeq: 1,
          };
        }
        if (this.eventsCall === 2) {
          // ONE transient 404 — the events endpoint blips even though the session is alive and
          // still doing real work.
          const err = new Error('GET events -> 404');
          err.status = 404;
          throw err;
        }
        return { events: [], lastSeq: 1 }; // back to normal — no more events, settles to idle
      }
      if (method === 'GET' && path === '/api/sessions') {
        this.listCall++;
        // Listed the ENTIRE time — `running` while the blip is fresh, `idle` once the (simulated)
        // build has actually finished.
        return { sessions: [{ sessionId: this.sessionId, status: this.eventsCall <= 2 ? 'running' : 'idle' }] };
      }
      throw new Error(`FakePod: unhandled ${method} ${path}`);
    }
  }

  it('a session that blips a single events-poll 404 but stays LISTED and working does NOT throw "vanished"', async () => {
    const pod = new BlipsThenAliveFakePod();
    const sess = new ThingSession(pod);
    await sess.start();
    const turn = await sess.send('build something slow', {
      pollMs: 10,
      quietMs: 20,
      vanishPatienceMs: 500,
      vanishRecheckMs: 10,
    });
    expect(turn.lastText).toBe('working');
    expect(pod.listCall).toBeGreaterThan(1); // it actually re-checked liveness, not a one-shot verdict
  }, 5000);

  /** Simulates a session that drops out of `GET /api/sessions` and never comes back — the `!me`
   *  path's genuine-disappearance shape (evicted for good / pod actually rolled / scaled to zero). */
  class GenuinelyGoneFakePod {
    constructor() {
      this.sessionId = 's1';
      this.eventsCall = 0;
      this.messagePosted = false; // listed up through `start()`/`#ensureAlive()`; gone once the turn begins
    }
    async req(method, path) {
      if (method === 'POST' && path === '/api/sessions') return { sessionId: this.sessionId };
      if (method === 'POST' && path === `/api/sessions/${this.sessionId}/message`) {
        this.messagePosted = true;
        return { ok: true };
      }
      if (method === 'GET' && path === `/api/sessions/${this.sessionId}/asks?format=json`) return { asks: [] };
      if (method === 'GET' && path.startsWith(`/api/sessions/${this.sessionId}/events`)) {
        this.eventsCall++;
        if (this.eventsCall === 1) {
          return {
            events: [{ seq: 1, event: { type: 'display', descriptor: { props: { text: 'started' } } } }],
            lastSeq: 1,
          };
        }
        return { events: [], lastSeq: 1 };
      }
      if (method === 'GET' && path === '/api/sessions') {
        // Listed right up through dispatch (so `start()`/`#ensureAlive()` see a normal, resident
        // session) — then drops out of the list for good the moment the turn is dispatched, exactly
        // the genuine mid-turn disappearance `#confirmVanished` must NOT forgive.
        return { sessions: this.messagePosted ? [] : [{ sessionId: this.sessionId, status: 'running' }] };
      }
      throw new Error(`FakePod: unhandled ${method} ${path}`);
    }
  }

  it('a session that genuinely, persistently delists throws the honest "vanished" error', async () => {
    const pod = new GenuinelyGoneFakePod();
    const sess = new ThingSession(pod);
    await sess.start();
    await expect(
      sess.send('build something', { pollMs: 10, quietMs: 20, vanishPatienceMs: 60, vanishRecheckMs: 10 }),
    ).rejects.toThrow(/left the resident set mid-turn|vanished mid-turn/);
  }, 5000);
});

// The soft-cap/extension fix: a fixed `timeoutMs` declared a legitimately slow build (observed
// >20min, events flowing, session listed `running` the whole time — 06 run 25 / 07 run 22) "timed
// out" mid-work while the server turn then completed fine. These pin the new wait contract:
// `timeoutMs` is SOFT (activity extends it), `stallGraceMs` of silence past it ends the wait
// promptly, and `hardCapMs` bounds even a never-quiet turn.
describe('ThingSession — soft cap extends while active, stalls and hard cap still throw', () => {
  /** Emits a fresh event on every poll for `emitMs` after dispatch, then goes quiet and idle —
   *  the slow-but-genuinely-working build shape. */
  class SlowButActiveFakePod {
    constructor(emitMs) {
      this.sessionId = 's1';
      this.emitMs = emitMs;
      this.t0 = null;
      this.seq = 0;
    }
    #working() {
      return this.t0 !== null && Date.now() - this.t0 < this.emitMs;
    }
    async req(method, path) {
      if (method === 'POST' && path === '/api/sessions') return { sessionId: this.sessionId };
      if (method === 'POST' && path === `/api/sessions/${this.sessionId}/message`) {
        this.t0 = Date.now();
        return { ok: true };
      }
      if (method === 'GET' && path === `/api/sessions/${this.sessionId}/asks?format=json`) return { asks: [] };
      if (method === 'GET' && path.startsWith(`/api/sessions/${this.sessionId}/events`)) {
        if (this.#working()) {
          this.seq++;
          return {
            events: [{ seq: this.seq, event: { type: 'display', descriptor: { props: { text: `work ${this.seq}` } } } }],
            lastSeq: this.seq,
          };
        }
        return { events: [], lastSeq: this.seq };
      }
      if (method === 'GET' && path === '/api/sessions') {
        return { sessions: [{ sessionId: this.sessionId, status: this.#working() ? 'running' : 'idle' }] };
      }
      throw new Error(`FakePod: unhandled ${method} ${path}`);
    }
  }

  it('a turn still emitting events past the soft cap is NOT timed out — it runs to completion', async () => {
    const pod = new SlowButActiveFakePod(400); // works for 400ms, 4x the soft cap below
    const sess = new ThingSession(pod);
    await sess.start();
    const turn = await sess.send('build something slow', {
      timeoutMs: 100,
      hardCapMs: 5_000,
      stallGraceMs: 1_000,
      pollMs: 10,
      quietMs: 20,
    });
    expect(turn.lastText).toMatch(/^work \d+$/); // finished and was judged, despite blowing the soft cap
  }, 10000);

  /** One event at dispatch, then silence forever — but the session stays listed `running`
   *  (a genuine hang, not a vanish). */
  class ActiveThenStalledFakePod {
    constructor() {
      this.sessionId = 's1';
      this.eventsCall = 0;
    }
    async req(method, path) {
      if (method === 'POST' && path === '/api/sessions') return { sessionId: this.sessionId };
      if (method === 'POST' && path === `/api/sessions/${this.sessionId}/message`) return { ok: true };
      if (method === 'GET' && path === `/api/sessions/${this.sessionId}/asks?format=json`) return { asks: [] };
      if (method === 'GET' && path.startsWith(`/api/sessions/${this.sessionId}/events`)) {
        this.eventsCall++;
        if (this.eventsCall === 1) {
          return { events: [{ seq: 1, event: { type: 'display', descriptor: { props: { text: 'started' } } } }], lastSeq: 1 };
        }
        return { events: [], lastSeq: 1 };
      }
      if (method === 'GET' && path === '/api/sessions') {
        return { sessions: [{ sessionId: this.sessionId, status: 'running' }] }; // never idle, never gone
      }
      throw new Error(`FakePod: unhandled ${method} ${path}`);
    }
  }

  it('a turn with NO activity past the soft cap throws promptly (stall grace), not at the hard cap', async () => {
    const pod = new ActiveThenStalledFakePod();
    const sess = new ThingSession(pod);
    await sess.start();
    await expect(
      sess.send('hang forever', {
        timeoutMs: 60,
        hardCapMs: 60_000, // far away — the throw must come from the stall grace, not this
        stallGraceMs: 150,
        pollMs: 10,
        quietMs: 20,
      }),
    ).rejects.toThrow(/no activity for 150ms past the 60ms soft cap/);
  }, 10000);

  it('a never-quiet turn is bounded by the hard cap', async () => {
    const pod = new SlowButActiveFakePod(60_000); // "works" far longer than the hard cap
    const sess = new ThingSession(pod);
    await sess.start();
    await expect(
      sess.send('run away', {
        timeoutMs: 50,
        hardCapMs: 300,
        stallGraceMs: 60_000, // activity never lapses — only the hard cap can end this
        pollMs: 10,
        quietMs: 20,
      }),
    ).rejects.toThrow(/hard cap 300ms/);
  }, 10000);
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

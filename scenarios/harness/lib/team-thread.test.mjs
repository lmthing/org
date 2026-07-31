import { describe, expect, it } from 'vitest';
import { ThreadSession } from './team-thread.mjs';

/**
 * A minimal in-memory team pod. `ThreadSession` only ever calls `member`/`members`/`postMessage`/
 * `threadMessages`/`socket` — see team-pod.mjs for the real HTTP surface these mirror. The fake
 * socket hands the test an `emit()` so a run can be scripted frame by frame, which is the only way
 * to pin the completion-signal logic without a live LLM.
 */
class FakeTeamPod {
  constructor() {
    this.posted = [];
    this.log = [];
    this.emit = null;
    this.seq = 0;
  }
  member(who) {
    return typeof who === 'object' ? who : { name: who, userId: `u-${who}`, role: 'editor' };
  }
  members() {
    return [this.member('ana')];
  }
  async socket(who, { onEvent }) {
    this.emit = onEvent;
    return { close: () => {} };
  }
  async postMessage(who, channelId, text, { threadId } = {}) {
    const message = {
      id: `m${++this.seq}`,
      ts: new Date(1_700_000_000_000 + this.seq * 1000).toISOString(),
      channelId,
      kind: 'user',
      text,
      userId: this.member(who).userId,
      ...(threadId ? { threadId } : {}),
    };
    this.posted.push(message);
    this.log.push(message);
    return { message };
  }
  async threadMessages(_who, _channelId, threadId) {
    return this.log.filter((m) => m.id === threadId || m.threadId === threadId);
  }
  /** THING posts into the thread: stored in the log AND broadcast, exactly as the pod does. */
  thingSays(channelId, threadId, fields) {
    const message = {
      id: `t${++this.seq}`,
      ts: new Date(1_700_000_000_000 + this.seq * 1000).toISOString(),
      channelId,
      kind: 'thing',
      threadId,
      sessionId: 'sess-1',
      ...fields,
    };
    this.log.push(message);
    this.emit({ type: 'message', message });
    return message;
  }
  status(channelId, threadId, status, activity, askId) {
    this.emit({ type: 'thing_status', channelId, threadId, status, ...(activity ? { activity } : {}), ...(askId ? { askId } : {}) });
  }
}

const FAST = { askGraceMs: 60, parkGraceMs: 200, pollMs: 10, timeoutMs: 4000, stallGraceMs: 500 };

describe('ThreadSession completion signal', () => {
  it('does NOT finish on a `thing` message alone — it waits for the thing_status terminal', async () => {
    // The ambiguity this guards: an ask() ALSO posts a `thing` message, so "a thing message
    // appeared" cannot mean "the turn finished".
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' });
    await thread.open();

    const turn = thread.ask('ana', '@thing hello', FAST);
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    pod.status('general', threadId, 'running');
    pod.thingSays('general', threadId, { text: 'a partial answer' });

    let settled = false;
    void turn.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toBe(false); // the message landed, but nothing said the turn is over

    pod.status('general', threadId, 'done');
    const result = await turn;
    expect(result.status).toBe('done');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('a partial answer');
  });

  it('reads the reply text and BLOCKS from the stored log, not from the socket frame', async () => {
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' });
    await thread.open();
    const turn = thread.ask('ana', '@thing build me a table', FAST);
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    pod.thingSays('general', threadId, {
      text: 'Here it is.',
      blocks: [{ type: 'Heading', props: {}, children: ['Costs'] }],
    });
    pod.status('general', threadId, 'done');

    const result = await turn;
    expect(result.blocks).toEqual([{ type: 'Heading', props: {}, children: ['Costs'] }]);
    expect(result.sessionId).toBe('sess-1');
    expect(result.threadId).toBe(threadId);
  });

  it('carries an `error` terminal through as a failed turn rather than throwing', async () => {
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' });
    await thread.open();
    const turn = thread.ask('ana', '@thing do the impossible', FAST);
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    pod.thingSays('general', threadId, { kind: 'system', text: 'THING could not answer: boom' });
    pod.status('general', threadId, 'error');

    const result = await turn;
    expect(result.status).toBe('error');
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/could not answer/);
  });
});

describe('ThreadSession parking on a question', () => {
  it('answers the question IN THE THREAD and lets the resumed turn finish', async () => {
    const pod = new FakeTeamPod();
    const seen = [];
    const thread = new ThreadSession(pod, {
      channelId: 'general',
      onAsk: (m) => {
        seen.push(m.text);
        return 'Teal, please.';
      },
    });
    await thread.open();

    const turn = thread.ask('ana', '@thing which colour?', FAST);
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    pod.status('general', threadId, 'running');
    pod.thingSays('general', threadId, { text: 'Teal or amber?', blocks: [{ type: 'Paragraph', props: {}, children: ['Teal or amber?'] }] });

    // The answer must be posted as a plain threaded reply — that is what `answerPendingAsk`
    // consumes. Wait for it, then let the resumed turn terminate.
    await new Promise((r) => setTimeout(r, 150));
    const answer = pod.posted.find((m) => m.text === 'Teal, please.');
    expect(answer).toBeTruthy();
    expect(answer.threadId).toBe(threadId);
    expect(seen).toEqual(['Teal or amber?']);

    pod.thingSays('general', threadId, { text: 'Teal it is.' });
    pod.status('general', threadId, 'done');
    const result = await turn;
    expect(result.status).toBe('done');
    expect(result.answered).toBe(1);
    expect(result.asks).toHaveLength(1);
    // The question is NOT the answer: it must not be reported as what THING replied.
    expect(result.text).toBe('Teal it is.');
  });

  it('returns `parked` instead of hanging when nothing answers the question', async () => {
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' }); // no onAsk
    await thread.open();
    const turn = thread.ask('ana', '@thing which colour?', FAST);
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    pod.thingSays('general', threadId, { text: 'Teal or amber?' });

    const result = await turn;
    expect(result.status).toBe('parked');
    expect(result.ok).toBe(false);
    expect(result.asks).toHaveLength(1);
    expect(result.answered).toBe(0);
    // Nothing was posted on the caller's behalf — a question left open stays open.
    expect(pod.posted).toHaveLength(1);
  });
});

describe('ThreadSession threading', () => {
  it('say() posts into the SAME thread — which is how a second member reaches one session', async () => {
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' });
    await thread.open();

    const first = thread.ask('ana', '@thing remember Bluefin', FAST);
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    pod.thingSays('general', threadId, { text: 'Saved.' });
    pod.status('general', threadId, 'done');
    await first;

    const second = thread.say('bo', 'what was the codename?', FAST);
    await new Promise((r) => setTimeout(r, 20));
    // No @thing mention, and it carries the thread id — the two things that make it the same
    // conversation for a different person.
    const bo = pod.posted.at(-1);
    expect(bo.threadId).toBe(threadId);
    expect(bo.userId).toBe('u-bo');
    expect(bo.text).not.toMatch(/@thing/);

    pod.thingSays('general', threadId, { text: 'Bluefin.' });
    pod.status('general', threadId, 'done');
    const result = await second;
    expect(result.text).toBe('Bluefin.'); // the previous turn's reply is not re-reported
    expect(result.sessionId).toBe('sess-1');
  });

  it('throws rather than guessing when say() is called with no open thread', async () => {
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' });
    await thread.open();
    await expect(thread.say('ana', 'hello')).rejects.toThrow(/needs an open thread/);
  });

  it('throws when a turn never reaches a terminal, carrying the partial turn on the error', async () => {
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' });
    await thread.open();
    await expect(
      thread.ask('ana', '@thing hello', { ...FAST, timeoutMs: 120, stallGraceMs: 60 }),
    ).rejects.toThrow(/no thing_status terminal/);
  });
});

describe('ThreadSession — the pod SAYS it is parked', () => {
  it('acts on `thing_status: waiting` immediately, without waiting out the ask grace', async () => {
    const pod = new FakeTeamPod();
    const asked = [];
    const thread = new ThreadSession(pod, {
      channelId: 'general',
      onAsk: (m) => { asked.push(m.ask?.id); return 'Teal.'; },
    });
    await thread.open();
    // A grace long enough that the heuristic could NOT have fired — only the `waiting` frame can.
    const turn = thread.ask('ana', '@thing which colour?', { ...FAST, askGraceMs: 60_000 });
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    const q = pod.thingSays('general', threadId, { text: 'Teal or amber?', ask: { id: 'ask-9', expiresAt: '2026-08-01T00:00:00Z' } });
    pod.status('general', threadId, 'waiting', undefined, 'ask-9');

    await new Promise((r) => setTimeout(r, 200));
    expect(asked).toEqual(['ask-9']);
    const answer = pod.posted.find((m) => m.text === 'Teal.');
    expect(answer?.threadId).toBe(threadId);

    pod.thingSays('general', threadId, { text: 'Teal it is.' });
    pod.status('general', threadId, 'done');
    const result = await turn;
    expect(result.status).toBe('done');
    expect(result.asks[0]).toMatchObject({ askId: 'ask-9', expiresAt: '2026-08-01T00:00:00Z', answeredWith: 'Teal.' });
    expect(result.text).toBe('Teal it is.');
    void q;
  });

  it('still reports a park when nothing answers it, carrying the ask id', async () => {
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' });
    await thread.open();
    const turn = thread.ask('ana', '@thing which colour?', { ...FAST, askGraceMs: 60_000, parkGraceMs: 150 });
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    pod.thingSays('general', threadId, { text: 'Teal or amber?', ask: { id: 'ask-7', expiresAt: 'later' } });
    pod.status('general', threadId, 'waiting', undefined, 'ask-7');
    const result = await turn;
    expect(result.status).toBe('parked');
    expect(result.asks[0].askId).toBe('ask-7');
    expect(pod.posted).toHaveLength(1);
  });
});

describe('ThreadSession — a receipt is not a question', () => {
  it('does not report `parked` when a plain reply ANSWERED the ask', async () => {
    const pod = new FakeTeamPod();
    const thread = new ThreadSession(pod, { channelId: 'general' });
    await thread.open();
    const turn = thread.ask('ana', '@thing build it', { ...FAST, parkGraceMs: 150 });
    await new Promise((r) => setTimeout(r, 20));
    const threadId = pod.posted[0].id;
    pod.thingSays('general', threadId, { text: 'Where do reprint costs live?', ask: { id: 'ask-3', expiresAt: 'later' } });
    pod.status('general', threadId, 'waiting', undefined, 'ask-3');
    await new Promise((r) => setTimeout(r, 80));

    // The pod's receipt for the answer — a `system` message that RESOLVES the ask.
    pod.thingSays('general', threadId, {
      kind: 'system',
      text: 'Ana Duarte’s reply was taken as the answer to THING’s question: “separately.”',
      answersAsk: 'ask-3',
    });
    pod.thingSays('general', threadId, { text: 'Separately it is — done.' });
    pod.status('general', threadId, 'done');

    const result = await turn;
    expect(result.status).toBe('done');
    expect(result.text).toBe('Separately it is — done.');
    // Exactly one question was asked; the receipt must not have been counted as a second.
    expect(result.asks).toHaveLength(1);
    expect(result.asks[0].askId).toBe('ask-3');
  });
});

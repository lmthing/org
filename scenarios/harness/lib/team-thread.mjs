/**
 * Channel-thread session driver — the team analogue of `thing.mjs#ThingSession`.
 *
 * In `/chat` a session belongs to a PERSON: they create it, they send into it, they read the trace
 * back over their own socket. In a team channel a **thread owns the session**
 * (`routes/team-channels.ts#runThingReply` → `getOrCreateThreadSession(teamDir, channel:<id>,
 * <threadRoot>)`), so several different members talk to ONE THING conversation and it remembers
 * what any of them said. That is the property this driver exists to make assertable:
 *
 *   const thread = new ThreadSession(pod, { channelId, observeAs: 'ana' });
 *   await thread.open();
 *   const t1 = await thread.ask('ana', '@thing remember our codename is Bluefin');
 *   const t2 = await thread.say('bo', 'what codename did Ana give you?');   // SAME session
 *   t2.sessionId === t1.sessionId
 *
 * ── Which completion signal we trust, and why ───────────────────────────────────────────────────
 *
 * The pod publishes two candidate "it finished" signals on `/api/team/ws`:
 *
 *   (a) a `message` frame whose `kind` is `thing`, and
 *   (b) a `thing_status` frame going `running` → `done` | `error`.
 *
 * We trust **(b), the `thing_status` terminal**, for two reasons that are both in the product:
 *
 *   1. **(a) is ambiguous.** THING's `ask()` ALSO posts a `thing` message into the thread
 *      (`postAsk`, kind `'thing'`, blocks = the question descriptor). A driver that stopped at the
 *      first `thing` message would report a turn that is actually PARKED — suspended, waiting for a
 *      human — as a completed turn with the question as its answer.
 *   2. **(b) strictly follows the reply.** `runThingReply` appends the reply, broadcasts the
 *      `message` frame, and broadcasts the `done`/`error` frame with no `await` in between — so by
 *      the time the terminal reaches us the answer is already in hand AND already on disk. Waiting
 *      for the terminal therefore costs nothing and never races the content.
 *
 * The reply text/blocks are then re-read from `GET .../messages` at the end of the turn, because the
 * LOG is what a member scrolling back actually sees, and a channel reply is stored as **structure**
 * (`blocks`) — the descriptors, not the string they flatten to.
 *
 * ── Parking on a question ───────────────────────────────────────────────────────────────────────
 *
 * `ask()` in a channel suspends the turn until somebody replies in the thread; the next message
 * posted there is consumed as the answer (`answerPendingAsk`). There is NO event for it, so the
 * driver infers it: a `thing` message with no terminal behind it within `askGraceMs` is a question.
 * `onAsk(message)` may return a string to answer it (posted as `answerAs`, default the member whose
 * turn it is). If nothing answers, the driver does **not** hang — it returns a turn with
 * `status:'parked'` after `parkGraceMs` so the caller can assert on the park instead of dying at a
 * timeout.
 */
import { TeamSocket } from './team-pod.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Terminal statuses of a `thing_status` frame. */
const TERMINAL = new Set(['done', 'error']);

export class ThreadSession {
  /**
   * @param {import('./team-pod.mjs').TeamPod} pod
   * @param {object} opts
   * @param {string} opts.channelId              the channel this thread lives in
   * @param {string} [opts.observeAs]            identity the watching socket is opened with
   *        (defaults to the first cast member). It MATTERS for a DM: `audienceFor` fans DM events
   *        only to participants, so an outsider's socket sees nothing at all.
   * @param {string} [opts.threadId]             continue an existing thread instead of opening one
   * @param {(message:object)=>(string|undefined)} [opts.onAsk]  answer a question THING posts into
   *        the thread. Return a string to reply; return undefined to leave it parked.
   * @param {string} [opts.answerAs]             who posts the `onAsk` answer (default: the asker)
   * @param {boolean} [opts.verbose=false]
   */
  constructor(pod, { channelId, observeAs, threadId, onAsk, answerAs, verbose = false } = {}) {
    if (!channelId) throw new Error('ThreadSession needs a channelId');
    this.pod = pod;
    this.channelId = channelId;
    this.observeAs = observeAs ?? pod.members()[0]?.name;
    this.threadId = threadId ?? null;
    this.sessionId = null;
    this.onAsk = onAsk;
    this.answerAs = answerAs;
    this.verbose = verbose;
    /** @type {TeamSocket|null} */
    this.socket = null;
    /** Every frame seen since `open()` — the driver reads it with a cursor per turn. */
    this.frames = [];
    /** Every turn played through this thread. */
    this.turns = [];
  }

  log(...a) {
    if (this.verbose) console.log('[thread]', ...a);
  }

  /** Connect the watching socket. Must happen BEFORE the first post or a fast turn can finish first. */
  async open() {
    if (this.socket) return this;
    this.socket = await this.pod.socket(this.observeAs, { onEvent: (e) => this.frames.push(e) });
    this.log('watching', this.channelId, 'as', this.pod.member(this.observeAs).name);
    return this;
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  /**
   * Open a NEW thread: a channel-level post (no `threadId`), which becomes its own thread root
   * (`threadRootOf`). Address THING with `@thing …` — a channel-level post needs the mention.
   */
  async ask(who, text, opts = {}) {
    const { message } = await this.pod.postMessage(who, this.channelId, text);
    this.threadId = message.threadId ?? message.id;
    this.log('thread', this.threadId, 'opened by', this.pod.member(who).name);
    return this.#await(who, message, opts);
  }

  /**
   * Reply INSIDE the open thread. No `@thing` needed: every reply in a thread THING is already in
   * addresses it (`addressesThing` — the thread session's existence is the test), which is what
   * makes a colleague's follow-up reach the same conversation.
   */
  async say(who, text, opts = {}) {
    if (!this.threadId) throw new Error('say() needs an open thread — call ask() first (or pass threadId)');
    const { message } = await this.pod.postMessage(who, this.channelId, text, { threadId: this.threadId });
    return this.#await(who, message, opts);
  }

  /** Post into the thread WITHOUT waiting for THING (a member talking to another member). */
  async post(who, text, { threadId = this.threadId } = {}) {
    const { message } = await this.pod.postMessage(who, this.channelId, text, {
      ...(threadId ? { threadId } : {}),
    });
    return message;
  }

  /** The thread's messages as the LOG holds them (root first). */
  messages(who = this.observeAs) {
    return this.pod.threadMessages(who, this.channelId, this.threadId);
  }

  /**
   * Wait out one turn.
   *
   * @param {object} who          the member who posted (asks are answered as them by default)
   * @param {object} sent         their stored message
   * @param {object} opts
   * @param {number} [opts.timeoutMs=900000]    soft budget for the whole turn
   * @param {number} [opts.hardCapMs=2700000]   absolute ceiling — a live build can legitimately run
   *        for many minutes, but a hang must still die
   * @param {number} [opts.stallGraceMs=300000] past the soft cap, extend while frames keep arriving
   * @param {number} [opts.askGraceMs=12000]    quiet after a `thing` message before calling it a question
   * @param {number} [opts.parkGraceMs=60000]   how long to sit on an UNANSWERED question before returning
   * @param {number} [opts.pollMs=250]
   * @param {(message:object)=>(string|undefined)} [opts.onAsk]  overrides the session-level `onAsk`
   *        for this turn only (pass `null` to deliberately leave a question unanswered and assert
   *        the park).
   */
  async #await(who, sent, {
    timeoutMs = 900_000,
    hardCapMs = 2_700_000,
    stallGraceMs = 300_000,
    askGraceMs = 12_000,
    parkGraceMs = 60_000,
    pollMs = 250,
    onAsk = this.onAsk,
  } = {}) {
    const threadId = this.threadId;
    const t0 = Date.now();
    // Frames that arrived between the POST returning and this loop starting are already buffered in
    // `this.frames`; resume at the previous turn's mark so nothing is missed and nothing counted twice.
    let cursor = this._cursor ?? 0;

    const seen = [];
    const replies = [];
    const asks = [];
    const activity = [];
    const apps = [];
    let running = false;
    let terminal = null;
    let lastFrameAt = Date.now();
    let lastThingAt = null;
    let parkedSince = null;
    let answered = 0;

    const mine = (f) =>
      (f.type === 'message' && f.message?.channelId === this.channelId &&
        (f.message.id === threadId || f.message.threadId === threadId)) ||
      (f.type !== 'message' && f.channelId === this.channelId && f.threadId === threadId);

    while (
      Date.now() - t0 < timeoutMs ||
      (Date.now() - t0 < hardCapMs && Date.now() - lastFrameAt < stallGraceMs)
    ) {
      // ── drain new frames ───────────────────────────────────────────────────────────────────
      while (cursor < this.frames.length) {
        const f = this.frames[cursor++];
        if (!mine(f)) continue;
        seen.push(f);
        lastFrameAt = Date.now();
        if (f.type === 'message') {
          const m = f.message;
          if (m.id === sent.id) continue; // our own post echoed back
          if (m.kind === 'thing' || m.kind === 'system') {
            replies.push(m);
            lastThingAt = Date.now();
            parkedSince = null;
          }
          if (m.app) apps.push(m.app);
        } else if (f.type === 'thing_status') {
          if (f.status === 'running') {
            running = true;
            if (f.activity) activity.push(f.activity);
          } else if (TERMINAL.has(f.status)) {
            terminal = f.status;
          }
        } else if (f.type === 'app_created') {
          apps.push({ projectId: f.projectId, name: f.name });
        }
      }

      if (terminal) break;

      // ── a `thing` message with no terminal behind it is a QUESTION ─────────────────────────
      if (lastThingAt && Date.now() - lastThingAt >= askGraceMs) {
        const question = replies[replies.length - 1];
        if (!asks.some((a) => a.message.id === question.id)) {
          asks.push({ message: question, answeredWith: null });
          this.log('parked on a question:', (question.text ?? '').slice(0, 140));
          const answer = onAsk ? onAsk(question, { threadId, channelId: this.channelId }) : undefined;
          if (typeof answer === 'string' && answer.length) {
            asks[asks.length - 1].answeredWith = answer;
            answered++;
            lastThingAt = null;
            parkedSince = null;
            // The next message in the thread IS the answer (`answerPendingAsk`), so this must not
            // look like a fresh mention — post it plainly, in-thread, as a person would.
            await this.pod.postMessage(this.answerAs ?? who, this.channelId, answer, { threadId });
            lastFrameAt = Date.now();
          } else {
            parkedSince = Date.now();
          }
        }
        // Nothing is going to answer it. Return the park rather than burning the whole budget:
        // a turn suspended on a question may legitimately wait forever.
        if (parkedSince && Date.now() - parkedSince >= parkGraceMs) {
          return this.#turn({ threadId, sent, status: 'parked', running, replies, asks, activity, apps, seen, t0, cursor });
        }
      }

      await sleep(pollMs);
    }

    if (!terminal) {
      const turn = await this.#turn({
        threadId, sent, status: 'timeout', running, replies, asks, activity, apps, seen, t0, cursor,
      });
      throw Object.assign(
        new Error(
          `thread ${threadId} in #${this.channelId}: no thing_status terminal after ${Date.now() - t0}ms ` +
            `(running=${running}, replies=${replies.length}, asks=${asks.length})`,
        ),
        { turn },
      );
    }
    return this.#turn({ threadId, sent, status: terminal, running, replies, asks, activity, apps, seen, t0, cursor, answered });
  }

  /**
   * Assemble the turn a scenario asserts on. The reply is re-read from the LOG: `blocks` is what
   * the channel actually stored, and a socket frame we might have missed is not an excuse for
   * reporting an empty answer.
   */
  async #turn({ threadId, sent, status, running, replies, asks, activity, apps, seen, t0, cursor, answered = 0 }) {
    this._cursor = cursor;
    const logged = await this.pod
      .threadMessages(this.observeAs, this.channelId, threadId)
      .catch(() => []);
    const after = logged.filter((m) => m.ts >= sent.ts && m.id !== sent.id && (m.kind === 'thing' || m.kind === 'system'));
    const answerMessages = after.length ? after : replies;
    // The ANSWER is the last thing THING posted that is not the question it parked on.
    const askIds = new Set(asks.map((a) => a.message.id));
    const answers = answerMessages.filter((m) => !askIds.has(m.id));
    const reply = answers[answers.length - 1] ?? null;

    const turn = {
      threadId,
      channelId: this.channelId,
      sent,
      status,
      ok: status === 'done',
      running,
      /** The flattened prose of the final reply — what a notification or a plain client reads. */
      text: reply?.text ?? '',
      /** The STORED display descriptors. A THING channel reply is structure, not the string it flattens to. */
      blocks: reply?.blocks ?? null,
      reply,
      /** Every `thing`/`system` message this turn put in the thread, in order. */
      replies: answerMessages,
      /** Questions THING posted into the thread, and what (if anything) answered them. */
      asks,
      answered,
      /** THING's live `setActivity()` text while it ran. */
      activity,
      /** Apps this turn produced and pinned to the channel. */
      apps,
      sessionId: reply?.sessionId ?? answerMessages.find((m) => m.sessionId)?.sessionId ?? this.sessionId,
      durationMs: Date.now() - t0,
      events: seen,
    };
    if (turn.sessionId) this.sessionId = turn.sessionId;
    this.turns.push(turn);
    this.log(`turn ${status} in ${(turn.durationMs / 1000).toFixed(1)}s — ${turn.text.slice(0, 120)}`);
    return turn;
  }
}

/** Convenience: open a watching socket and a thread in one call. */
export async function openThread(pod, opts) {
  const thread = new ThreadSession(pod, opts);
  await thread.open();
  return thread;
}

export { TeamSocket };

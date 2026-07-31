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
   * @param {() => unknown} [opts.liveness]      "the pod is still working" probe — see `#await`
   * @param {boolean} [opts.verbose=false]
   */
  constructor(pod, { channelId, observeAs, threadId, onAsk, answerAs, liveness, verbose = false } = {}) {
    if (!channelId) throw new Error('ThreadSession needs a channelId');
    this.pod = pod;
    this.channelId = channelId;
    this.observeAs = observeAs ?? pod.members()[0]?.name;
    this.threadId = threadId ?? null;
    this.sessionId = null;
    this.onAsk = onAsk;
    this.answerAs = answerAs;
    this.liveness = liveness;
    this.verbose = verbose;
    /** @type {TeamSocket|null} */
    this.socket = null;
    /** Every frame seen since `open()` — the driver reads it with a cursor per turn. */
    this.frames = [];
    /** Every turn played through this thread. */
    this.turns = [];
    /**
     * True while a turn of this thread is SUSPENDED on a question nobody answered.
     *
     * It changes what the next message means: `answerPendingAsk` consumes it as the ANSWER and the
     * suspended turn resumes, rather than starting a new one. A runner that does not know this
     * reports the next step as "a turn that produced no new work", when in fact it resolved the
     * previous one — so the flag is carried onto the turn as `consumedPendingAsk`.
     */
    this.parked = false;
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
   * Re-establish the watching socket after the pod went away (a `restart_pod` step).
   *
   * The buffered frames and the per-turn cursor are kept: the thread's history on disk is
   * unaffected by a restart, and dropping them would make the next turn re-read old frames.
   */
  async reconnect() {
    this.close();
    return this.open();
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

  /** Dispatch the post for a NEW thread without waiting — the two halves of `ask()`, for a
   *  concurrent beat that must get every message on the wire before it waits for any of them. */
  async dispatchAsk(who, text) {
    const { message } = await this.pod.postMessage(who, this.channelId, text);
    this.threadId = message.threadId ?? message.id;
    return message;
  }

  /** The waiting half. Pair with {@link dispatchAsk}/{@link dispatchSay}. */
  awaitTurn(who, sent, opts = {}) {
    return this.#await(who, sent, opts);
  }

  /** Dispatch an in-thread reply without waiting (see {@link dispatchAsk}). */
  async dispatchSay(who, text) {
    if (!this.threadId) throw new Error('dispatchSay() needs an open thread');
    const consumed = this.parked;
    const { message } = await this.pod.postMessage(who, this.channelId, text, { threadId: this.threadId });
    this.parked = false;
    message.consumedPendingAsk = consumed;
    return message;
  }

  /**
   * Reply INSIDE the open thread. No `@thing` needed: every reply in a thread THING is already in
   * addresses it (`addressesThing` — the thread session's existence is the test), which is what
   * makes a colleague's follow-up reach the same conversation.
   */
  async say(who, text, opts = {}) {
    if (!this.threadId) throw new Error('say() needs an open thread — call ask() first (or pass threadId)');
    // A thread parked on a question takes this message as the ANSWER (`answerPendingAsk`), which
    // resumes the suspended turn instead of starting a new one. Record that, so a step that looks
    // like it "produced nothing new" is read correctly.
    const consumed = this.parked;
    const { message } = await this.pod.postMessage(who, this.channelId, text, { threadId: this.threadId });
    this.parked = false;
    const turn = await this.#await(who, message, opts);
    turn.consumedPendingAsk = consumed;
    return turn;
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
   * @param {() => unknown} [opts.liveness]  an out-of-band "the pod is still working" probe, polled
   *        each loop; any CHANGE in the value it returns counts as activity.
   *
   * ⚠️ THE STALL GRACE CANNOT BE MEASURED ON CHANNEL FRAMES ALONE. A channel emits `thing_status`
   * only on `running`, on each `setActivity()`, and at the terminal — so a turn that spends twenty
   * minutes inside a build fork emits NOTHING the whole time. Keying "is it still alive" on frames
   * killed 20-studio's step 1 at 15.3 minutes (`no thing_status terminal … running=true, replies=0`)
   * while the pod was demonstrably mid-build, and reported a harness timeout as a product failure.
   * Hence `liveness`: the team runner passes the run's growing `sessions.log`, which is real
   * evidence the pod is still emitting, and the budgets below are sized for a build rather than for
   * a chat reply.
   */
  async #await(who, sent, {
    timeoutMs = 1_800_000,
    hardCapMs = 3_600_000,
    stallGraceMs = 900_000,
    askGraceMs = 12_000,
    parkGraceMs = 60_000,
    pollMs = 250,
    onAsk = this.onAsk,
    liveness = this.liveness,
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
    let liveMark = liveness ? liveness() : null;
    let lastThingAt = null;
    let parkedSince = null;
    /** Set by a `thing_status: waiting` frame — the pod SAYING it is parked, not us guessing. */
    let waitingAskId = null;
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
            // Only a genuine `thing` message can start the "is this a question?" clock — see the
            // askable filter below.
            if (m.kind === 'thing' && !m.answersAsk) lastThingAt = Date.now();
            parkedSince = null;
          }
          if (m.app) apps.push(m.app);
        } else if (f.type === 'thing_status') {
          if (f.status === 'running') {
            running = true;
            if (f.activity) activity.push(f.activity);
          } else if (f.status === 'waiting') {
            // The AUTHORITATIVE park signal. Before the pod emitted this, a park could only be
            // INFERRED (a `thing` message with no terminal behind it within `askGraceMs`), which
            // costs twelve seconds and cannot tell a question apart from a slow answer. `askId`
            // names the ask, so the reply that answers it can say which one it answered.
            waitingAskId = f.askId ?? waitingAskId;
            running = true;
          } else if (TERMINAL.has(f.status)) {
            terminal = f.status;
          }
        } else if (f.type === 'app_created') {
          apps.push({ projectId: f.projectId, name: f.name });
        }
      }

      if (terminal) break;

      // Out-of-band liveness: a build emits no channel frames for minutes at a time (see the
      // docblock). A pod that is still writing is still working.
      if (liveness) {
        const mark = liveness();
        if (mark !== liveMark) {
          liveMark = mark;
          lastFrameAt = Date.now();
        }
      }

      // ── a parked question ──────────────────────────────────────────────────────────────────
      // `waiting` is the pod telling us; the grace-based read is the fallback for a turn that
      // parks without one (and for a pod that predates the frame).
      const parkedNow = waitingAskId !== null || (lastThingAt && Date.now() - lastThingAt >= askGraceMs);
      if (parkedNow) {
        // A QUESTION is a `thing` message THING posted to ask something. Two things are not:
        //   - the `system` RECEIPT the pod appends when a plain reply is taken as the answer
        //     ("Ana Duarte's reply was taken as the answer to THING's question: …"), and
        //   - any message carrying `answersAsk`, which by definition resolves one.
        // Treating the receipt as a new question reported step 8 of 20-studio run 4 as `parked`
        // when the ask had just been ANSWERED — the driver inventing a question nobody asked.
        const askable = replies.filter((m) => m.kind === 'thing' && !m.answersAsk);
        const question =
          askable.filter((m) => (waitingAskId ? m.ask?.id === waitingAskId : true)).slice(-1)[0] ??
          askable[askable.length - 1];
        if (!question) {
          await sleep(pollMs);
          continue;
        }
        if (!asks.some((a) => a.message.id === question.id)) {
          asks.push({ message: question, askId: question.ask?.id ?? waitingAskId ?? null, expiresAt: question.ask?.expiresAt ?? null, answeredWith: null });
          this.log('parked on a question:', (question.text ?? '').slice(0, 140));
          const answer = onAsk ? onAsk(question, { threadId, channelId: this.channelId }) : undefined;
          if (typeof answer === 'string' && answer.length) {
            asks[asks.length - 1].answeredWith = answer;
            answered++;
            lastThingAt = null;
            parkedSince = null;
            waitingAskId = null;
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
    const askIds = new Set(asks.map((a) => a.message.id));
    const answers = answerMessages.filter((m) => !askIds.has(m.id));
    /**
     * THE ANSWER IS THE LAST `thing` MESSAGE — NOT the last message in the thread.
     *
     * `announceNewApps` appends a `system` card ("<project> is ready.") AFTER the reply and after the
     * terminal, so "the last thing in the thread" is frequently the card rather than the answer. That
     * reported THING's reply to 20-studio step 2 as the four words `"user is ready."` when it had in
     * fact answered with a full account of what it built. A `system` card is the POD talking about the
     * turn; only a `thing` message is THING talking to the team.
     *
     * A failed turn is the exception: its explanation is posted as `system` (`runThingReply`'s catch),
     * and there is no `thing` message at all — so fall back to the last non-ask message, which is that.
     */
    const thingAnswers = answers.filter((m) => m.kind === 'thing');
    const reply = thingAnswers[thingAnswers.length - 1] ?? answers[answers.length - 1] ?? null;
    /** The pod's own cards about this turn (a built app being pinned) — not part of the answer. */
    const systemCards = answers.filter((m) => m.kind === 'system');

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
      /** The pod's cards about the turn (an app being pinned), kept apart from what THING SAID. */
      systemCards,
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
    // A turn that ended parked leaves the thread holding a suspended turn — see `this.parked`.
    this.parked = status === 'parked' && asks.some((a) => !a.answeredWith);
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

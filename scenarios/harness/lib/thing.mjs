/**
 * THING session driver — talks to a real agent session over the pod's HTTP API and gives a
 * scenario everything it needs to ASSERT on behaviour, not just on final text.
 *
 * Why HTTP and not the WebSocket the /chat SPA uses: the WS needs a dep and buys us nothing here.
 * The pod exposes the same surface over HTTP (sdk/org/libs/cli/src/server/web/agent-api.ts):
 *
 *   POST /api/sessions                      {projectId, agentSlug?, resumeSessionId?, budget?}
 *   POST /api/sessions/:id/message          {content}                         → 202
 *   GET  /api/sessions/:id/events?since=N&format=json                          → {events,lastSeq}
 *   GET  /api/sessions/:id/asks?format=json                                    → {asks}
 *   POST /api/sessions/:id/ask/:askId       {value}                            → answer a prompt
 *   DELETE /api/sessions/:id/ask/:askId                                        → cancel a prompt (→ null)
 *
 * The event stream is the full execution trace (sdk/org/libs/core/src/sandbox/trace.ts), so a
 * scenario can assert on the things that actually matter — which agents THING delegated to, which
 * consent-marked globals it called, which yields resolved, tokens burned, errors raised — instead
 * of grading a paragraph of prose.
 *
 * IMPORTANT (consent): the consent prompter is only wired for INTERACTIVE sessions
 * (session-manager.ts — `consentPrompter: args.interactive ? … : undefined`). A session created
 * through `POST /api/sessions` is interactive, so consent cards appear as asks here. Headless
 * paths (hooks, delegates, webhook dispatch) fail closed by design — that is a feature to assert,
 * not a bug to work around.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Sentinel an `onAsk` callback returns to CANCEL an open ask — `DELETE /api/sessions/:id/ask/:id`,
 * which resolves the agent's `await ask(...)` with `null` (true-cancel fidelity) — as opposed to
 * ANSWERING it with `''`/`null` via `POST .../ask/:id` (indistinguishable to the agent by value, but
 * NOT the same wire action: a real dismiss is a DELETE, never a submitted empty value). A shared,
 * frozen plain object (not a `Symbol`) so it still JSON-serializes into step evidence instead of
 * silently vanishing from it.
 */
export const CANCEL_ASK = Object.freeze({ __cancelAsk: true });

export class ThingSession {
  /**
   * @param {import('./pod.mjs').Pod} pod
   * @param {object} opts
   * @param {string} [opts.projectId='user']   project to run in ('user' = the default project)
   * @param {string} [opts.agentSlug='thing']  THING is the default agent
   * @param {string} [opts.spaceRef]           bind to a project SPACE's agent (`<space>/<agent>`)
   *        instead of THING — the only way to exercise that specialist's OWN capability profile.
   * @param {(descriptor:object)=>unknown} [opts.onAsk]  answer asks (consent cards, forms).
   *        Return `undefined` to leave the ask open (the scenario answers it manually).
   * @param {boolean} [opts.verbose=false]     stream a live log to stdout
   */
  constructor(pod, opts = {}) {
    this.pod = pod;
    this.projectId = opts.projectId ?? 'user';
    this.agentSlug = opts.agentSlug ?? 'thing';
    this.spaceRef = opts.spaceRef;
    this.onAsk = opts.onAsk;
    this.verbose = opts.verbose ?? false;
    this.sessionId = null;
    /** every trace event seen, in order — the scenario's source of truth */
    this.events = [];
    /** asks the driver saw, with what it answered */
    this.asks = [];
    this.lastSeq = 0;
  }

  log(...a) {
    if (this.verbose) console.log('[thing]', ...a);
  }

  /** Create the session. Init is async pod-side — `send()` waits it out. */
  async start({ resumeSessionId, budget, spaceRef = this.spaceRef } = {}) {
    const body = {
      projectId: this.projectId,
      agentSlug: this.agentSlug,
      // Bind the session to a PROJECT SPACE's own agent (`<space>/<agent>`) instead of THING
      // (session-manager `_initProjectSession` → `parseSpaceRef`). This is what lets a scenario
      // probe one specialist's real capability profile directly, rather than inferring it from
      // what THING chose to delegate.
      ...(spaceRef ? { spaceRef } : {}),
      ...(resumeSessionId ? { resumeSessionId } : {}),
      ...(budget ? { budget } : {}),
    };
    const { sessionId } = await this.pod.req('POST', '/api/sessions', body);
    this.sessionId = sessionId;
    this.log('session', sessionId);
    return sessionId;
  }

  /** Resume an existing session id (post-restart auto-resume scenario). */
  async resume(sessionId) {
    return this.start({ resumeSessionId: sessionId });
  }

  /**
   * Fast-forward past a RESUMED session's existing trace without attributing it to the next turn.
   *
   * A scenario that runs Act-by-Act (`--acts=`) resumes the same session from a FRESH process, where
   * `lastSeq` starts at 0 — so the first `pullEvents()` replays the WHOLE session history and
   * `turn(startSeq)` folds it into the first turn's slice. Any assertion over that slice then reads
   * *earlier Acts'* displays: scenario 10 saw a restraint check "pass" on a build summary printed
   * two Acts ago. Call this right after `start()`/`resume()` so a turn's events are only its own.
   */
  async syncToTail() {
    for (let i = 0; i < 30; i++) {
      const before = this.lastSeq;
      await this.pullEvents();
      if (this.lastSeq === before) break;
      await sleep(200);
    }
    this.events.length = 0; // replayed history is not the next turn's work
    return this.lastSeq;
  }

  /**
   * Pull new trace events since `lastSeq`.
   *
   * A long turn can spawn many delegate/headless sub-sessions; on a small pod (`maxSessions`) the
   * session manager may EVICT this top-level session shortly after its turn completes, so a poll
   * then 404s ("unknown session"). That is not a turn failure — the work already landed (assert it
   * on real pod state). So a 404 is surfaced as a soft signal (`this.sessionGone = true`) rather
   * than thrown; the settle loop treats it as turn-end once work has been seen.
   */
  async pullEvents() {
    let res;
    try {
      res = await this.pod.req('GET', `/api/sessions/${this.sessionId}/events?since=${this.lastSeq}&format=json`);
    } catch (err) {
      if (err?.status === 404) {
        this.sessionGone = true;
        return [];
      }
      throw err;
    }
    const { events, lastSeq } = res;
    for (const e of events ?? []) {
      this.events.push(e.event);
      if (this.verbose) this.#logEvent(e.event);
    }
    if (typeof lastSeq === 'number') this.lastSeq = lastSeq;
    return events ?? [];
  }

  #logEvent(ev) {
    switch (ev.type) {
      case 'yield':
        this.log(`  yield ${ev.kind}`, JSON.stringify(ev.args)?.slice(0, 140));
        break;
      case 'display':
        this.log('  display', JSON.stringify(ev.descriptor)?.slice(0, 200));
        break;
      case 'node_start':
        this.log(`  node_start ${ev.kind} ${ev.label}`);
        break;
      case 'node_end':
        this.log(`  node_end ${ev.nodeId} ${ev.status} ${ev.durationMs}ms`);
        break;
      case 'eval_error':
      case 'typecheck_error':
        this.log(`  !! ${ev.type}: ${ev.message?.slice(0, 200)}`);
        break;
      default:
        break;
    }
  }

  /** Open asks, with the raw descriptor (a ConsentCard is `descriptor.type === 'ConsentCard'`). */
  async openAsks() {
    const { asks } = await this.pod.req('GET', `/api/sessions/${this.sessionId}/asks?format=json`);
    return asks ?? [];
  }

  /**
   * Answer an ask. Consent approval is anything in {true, 'approve', {approved:true},
   * {approve:true}} (core/src/globals/consent.ts `isConsentApproval`); ANYTHING else — including
   * null — is a denial.
   */
  async answerAsk(askId, value) {
    await this.pod.req('POST', `/api/sessions/${this.sessionId}/ask/${askId}`, { value });
    this.log('answered ask', askId, JSON.stringify(value));
  }

  /** Cancel (dismiss) an open ask — `DELETE /api/sessions/:id/ask/:askId` — instead of answering
   *  it. See `CANCEL_ASK` above for why this is a distinct wire action from `answerAsk(id, null)`. */
  async cancelAsk(askId) {
    await this.pod.req('DELETE', `/api/sessions/${this.sessionId}/ask/${askId}`);
    this.log('cancelled ask', askId);
  }

  /**
   * Send a user message and wait for the turn to settle.
   *
   * "Settled" = the session is idle AND the trace has stopped growing for `quietMs`. We can't
   * key on a single `turn_end` because delegates/forks emit their own in sub-contexts; the
   * idle+quiet pair is the only reliable edge over HTTP.
   *
   * While waiting we drain asks through `onAsk` — that is how consent cards get approved mid-turn.
   * A turn blocked on an unanswered ask never goes idle, so an un-handled consent card surfaces as
   * a timeout with the ask still open (which the scenario can assert on).
   */
  /**
   * Ensure `this.sessionId` still exists; if it was evicted (`maxSessions` on a small pod), start a
   * fresh session — resuming the old id when the pod still has its snapshot, else a clean new one.
   * The project (its spaces, app, db) persists on disk regardless, so a re-established session still
   * sees everything built so far; only in-VM conversation memory is lost (acceptable — the scenario
   * drives self-contained follow-ups).
   */
  async #ensureAlive() {
    if (!this.sessionId) return;
    const list = await this.pod.req('GET', '/api/sessions').catch(() => ({ sessions: [] }));
    const alive = (list.sessions ?? []).some((s) => s.sessionId === this.sessionId);
    if (alive) return;
    this.log('session evicted — re-establishing');
    const prev = this.sessionId;
    try {
      await this.start({ resumeSessionId: prev });
    } catch {
      await this.start();
    }
    // The re-established session replays its whole persisted trace from seq 0. We ALREADY hold those
    // events, so appending the replay duplicates every past turn — and, worse, `turn(startSeq)` then
    // slices a window full of REPLAYED history and asserts on it as if it were the turn we just sent
    // (scenario 10 read a re-analysis of turn 1's images as the work of its "yes" turn). Drain the
    // replay to re-sync `lastSeq`, then discard it: it is history we already have.
    const held = this.events.length;
    this.lastSeq = 0;
    for (let i = 0; i < 30; i++) {
      const before = this.lastSeq;
      await this.pullEvents();
      if (this.lastSeq === before) break;
      await sleep(200);
    }
    this.events.length = held;
    this.sessionGone = false;
  }

  async send(content, opts = {}) {
    await this.#ensureAlive();
    return this.#dispatchAndWait(
      () => this.pod.req('POST', `/api/sessions/${this.sessionId}/message`, { content }),
      content,
      opts,
    );
  }

  /**
   * Send a user message WITH attachments (the file-upload path the real UI uses).
   *
   * The HTTP `POST /message` route is content-only — it silently drops attachments
   * (`sessions.ts` wires `sendMessage: (content) => manager.sendMessage(id, content)`, no third
   * arg). Only the WebSocket path carries `attachmentIds` (`ws/agent.ts` →
   * `msg.attachments.map(a => a.id)`). So to attach a file we open the same `/api/ws` socket the
   * `/chat` SPA uses, send one `{type:'sendMessage', content, attachments}` frame, then fall back to
   * the normal HTTP trace-poll to await the turn (the socket also streams the trace, but reusing the
   * HTTP settle-loop keeps one code path for "turn finished").
   *
   * @param {string} content
   * @param {Array<{id:string,kind:string,mediaType:string,url?:string,filename?:string}>} attachments
   *        AttachmentRefs from `pod.upload()`. The server trusts only `id` (re-reads bytes by id).
   */
  async sendWithAttachments(content, attachments, opts = {}) {
    const refs = attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      mediaType: a.mediaType,
      url: a.url ?? `/api/uploads/${a.id}`,
      ...(a.filename ? { filename: a.filename } : {}),
    }));
    await this.#ensureAlive();
    return this.#dispatchAndWait(
      () => this.#wsSend({ type: 'sendMessage', content, attachments: refs }),
      `${content}  [+${refs.length} attachment(s)]`,
      opts,
    );
  }

  /** Open the pod's chat WebSocket, send one frame, resolve when it's flushed, then close. */
  #wsSend(frame) {
    const wsBase = this.pod.base.replace(/^http/, 'ws');
    const tokenQ = this.pod.token ? `&access_token=${encodeURIComponent(this.pod.token)}` : '';
    const url = `${wsBase}/api/ws?sessionId=${this.sessionId}${tokenQ}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url); // Node ≥22 global WebSocket — zero-dep
      const fail = (e) => reject(e instanceof Error ? e : new Error(`ws error: ${JSON.stringify(e)}`));
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify(frame));
        // Give the frame a beat to flush, then close; the turn is awaited over HTTP.
        setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          resolve();
        }, 750);
      });
      ws.addEventListener('error', fail);
    });
  }

  /**
   * Confirm a SUSPECTED vanish before believing it. Both call sites below react to a single missed
   * signal — one 404 on the events poll (`sessionGone`), or one `GET /api/sessions` response that
   * happens not to list this id — and neither, on its own, proves the session is actually gone.
   *
   * Scenario 07's `automator#build_live_project` ran ~18 minutes at ~1.7M cumulative input tokens
   * (build-completeness's compile_pass/fix_pass gate-and-retry loop is legitimately slow) and stayed
   * LISTED and working the ENTIRE time — but one blipped poll got the turn declared "vanished" ~90s
   * before the build genuinely finished, turning a real success into a false step failure. So a
   * suspected vanish gets a second look: keep re-listing `GET /api/sessions` every `recheckMs` until
   * either the id reappears (false alarm — clear `sessionGone` and tell the caller to keep waiting)
   * or `deadline` passes with it never once relisted (a GENUINE disappearance — evicted for good,
   * the pod actually rolled, or scaled fully to zero). The caller caps `deadline` at the turn's own
   * `hardCapMs`, so confirming a real vanish can't outrun the overall wait budget.
   *
   * This does NOT reintroduce the old silent-completion or the removed mid-turn re-send: a session
   * that stays gone for the whole patience window still throws the honest "vanished" error below.
   *
   * @returns {Promise<boolean>} true = genuinely gone (absent the whole window); false = false alarm
   */
  async #confirmVanished(deadline, recheckMs) {
    while (Date.now() < deadline) {
      await sleep(recheckMs);
      const list = await this.pod.req('GET', '/api/sessions').catch(() => null);
      const listed = !!list && (list.sessions ?? []).some((s) => s.sessionId === this.sessionId);
      if (listed) {
        this.sessionGone = false; // whatever tripped this (e.g. an events-poll 404) was a blip
        return false;
      }
    }
    return true;
  }

  // Per-turn wait budget: `timeoutMs` is a SOFT cap. A bulk-dump "yes" turn legitimately fans out
  // one architect build PER leg (organize_material's forEach) plus the app build, and a full build
  // under build-completeness's gate-and-retry loop has been observed to run well past 20 minutes
  // while demonstrably alive (events flowing, session listed `running`) — a fixed cap turned that
  // real success into a spurious "timed out" step error, the same class as the false-vanish below.
  // So past the soft cap the wait EXTENDS as long as fresh events keep arriving: a gap of
  // `stallGraceMs` with no activity ends it (a hung turn still dies promptly), and `hardCapMs`
  // bounds the whole wait absolutely. In production this streams as a background job; the harness
  // treats it as one turn, so the budget must fit a real multi-part build without giving a genuine
  // hang unbounded rope.
  //
  // `vanishPatienceMs`/`vanishRecheckMs` bound `#confirmVanished` above — generous enough to bridge a
  // multi-minute build's occasional blipped poll, but not unbounded (see `#confirmVanished`'s doc).
  async #dispatchAndWait(
    dispatch,
    logLine,
    {
      timeoutMs = 1_200_000,
      hardCapMs = 3_600_000,
      stallGraceMs = 300_000,
      quietMs = 4_000,
      pollMs = 1_500,
      vanishPatienceMs = 180_000,
      vanishRecheckMs = 3_000,
    } = {},
  ) {
    const startSeq = this.events.length;
    const t0 = Date.now();
    await dispatch();
    this.log('→', logLine.slice(0, 140));

    let lastChange = Date.now();
    let sawWork = false;
    let quietSince = null;
    this.sessionGone = false;

    while (
      Date.now() - t0 < timeoutMs ||
      (Date.now() - t0 < hardCapMs && Date.now() - lastChange < stallGraceMs)
    ) {
      const fresh = await this.pullEvents();
      if (fresh.length) {
        lastChange = Date.now();
        sawWork = true;
        quietSince = null;
      }

      // The session APPEARS to have vanished mid-turn (a 404 on the events poll — evicted past
      // `maxSessions`, or the pod rolled/woke from scale-to-zero under us — sessions are in-memory).
      // We saw work, but we do NOT know the turn FINISHED: a long build (build_specialist →
      // deep_research → architect) can be cut off with nothing durable written. The live app-build
      // target THING retargets to is DURABLE across a re-establish (SessionManager persists
      // `buildTargetProjectId` and re-seeds the holder on resume), so a CONFIRMED vanish is not a
      // recoverable "re-send" condition — it is an HONEST failure.
      //
      // But a single 404 is only a SUSPECTED vanish, not a confirmed one (see `#confirmVanished`) —
      // if the session is still LISTED and was doing work, keep waiting instead of throwing. Throw
      // (the runner records a step error) only once genuinely gone: returning silently is how
      // scenario 07's Act V "built" two sections and produced no space, table or page.
      if (this.sessionGone) {
        if (!sawWork) {
          throw new Error(`session ${this.sessionId} disappeared before doing any work (pod restart mid-init?)`);
        }
        const deadline = Math.min(Date.now() + vanishPatienceMs, t0 + hardCapMs);
        if (await this.#confirmVanished(deadline, vanishRecheckMs)) {
          throw new Error(
            `session ${this.sessionId} vanished mid-turn after doing work — the turn did not finish (pod eviction/restart?)`,
          );
        }
        // False alarm — re-listed within the patience window (`#confirmVanished` cleared
        // `sessionGone`). Fall through and keep waiting; the loop below re-polls fresh state.
      }

      // Drain asks (consent cards, forms) — an unanswered ask stalls the turn forever.
      for (const ask of await this.openAsks().catch(() => [])) {
        if (this.asks.some((a) => a.id === ask.id)) continue;
        const answer = this.onAsk ? this.onAsk(ask.descriptor, ask) : undefined;
        this.asks.push({ id: ask.id, descriptor: ask.descriptor, answered: answer });
        if (answer === CANCEL_ASK) {
          await this.cancelAsk(ask.id).catch(() => {});
          lastChange = Date.now();
        } else if (answer !== undefined) {
          await this.answerAsk(ask.id, answer).catch(() => {});
          lastChange = Date.now();
        }
      }

      const sessions = await this.pod.req('GET', '/api/sessions').catch(() => ({ sessions: [] }));
      const me = (sessions.sessions ?? []).find((s) => s.sessionId === this.sessionId);
      const idle = me?.status === 'idle';
      if (me?.status === 'error') {
        await this.pullEvents();
        throw new Error(`session entered error state: ${JSON.stringify(me)}`);
      }
      // The session was not found in THIS ONE `GET /api/sessions` poll, though we saw work. Same
      // hazard as `sessionGone` above: "missing from one poll" does NOT mean "the turn finished", but
      // it doesn't mean "gone for good" either — a single missed listing is exactly the false-alarm
      // shape `#confirmVanished` exists to rule out before we believe it. If it stays unlisted for the
      // WHOLE patience window, that IS a genuine drop of the in-memory session, and a turn that had
      // only just dispatched its delegates would otherwise be reported as a COMPLETED turn with no
      // results (scenario 10 then sent the user's "yes" into a session that had never made the offer
      // it was agreeing to). With the build target durable across a re-establish there is nothing to
      // re-send, so a CONFIRMED vanish is an HONEST failure: throw, so the runner records a real step
      // error instead of a silent completed turn.
      if (sawWork && !me && this.events.length > startSeq) {
        const deadline = Math.min(Date.now() + vanishPatienceMs, t0 + hardCapMs);
        if (await this.#confirmVanished(deadline, vanishRecheckMs)) {
          throw new Error(`session ${this.sessionId} left the resident set mid-turn — the turn did not finish (pod restart/eviction?)`);
        }
        // False alarm — re-listed within the patience window. Fall through; the loop re-polls fresh
        // state below, so this iteration doesn't fire the (now-stale) idle+quiet completion check.
      }

      if (sawWork && idle && Date.now() - lastChange >= quietMs) {
        if (quietSince === null) quietSince = Date.now();
        await this.pullEvents(); // final drain
        return this.turn(startSeq, Date.now() - t0);
      }
      await sleep(pollMs);
    }
    await this.pullEvents();
    const open = await this.openAsks();
    const elapsed = Date.now() - t0;
    throw Object.assign(
      new Error(
        `turn timed out after ${elapsed}ms (` +
          (elapsed >= hardCapMs
            ? `hard cap ${hardCapMs}ms`
            : `no activity for ${stallGraceMs}ms past the ${timeoutMs}ms soft cap`) +
          ')' +
          (open.length ? ` with ${open.length} unanswered ask(s): ${JSON.stringify(open)}` : ''),
      ),
      { turn: this.turn(startSeq, elapsed), openAsks: open },
    );
  }

  /** A view over just the events of one turn, with the derived facts a scenario asserts on. */
  turn(startSeq = 0, durationMs = 0) {
    const evs = this.events.slice(startSeq);
    return {
      durationMs,
      events: evs,
      text: textOf(evs),
      /** ONLY the turn's final display — the reply the user actually reads. `text` concatenates every
       *  display in the slice, which on a RESUMED session can still include replayed history, so a
       *  check about "what it answered" must read this, never `text`. */
      lastText: lastTextOf(evs),
      yields: evs.filter((e) => e.type === 'yield').map((e) => ({ kind: e.kind, args: e.args })),
      delegates: evs
        .filter((e) => e.type === 'yield' && e.kind === 'delegate')
        .map((e) => delegateRef(e.args)),
      // `attempt` is load-bearing: the turn loop retries a typecheck/eval error up to `maxRetries`
      // (default 3); an error logged at attempt < 3 is RECOVERED (the loop kept going and reset the
      // counter on the next success), one at attempt >= 3 made the loop give up (`return 'error'`).
      // A scenario that must distinguish "recovered = metric" from "unrecovered = hard fail" (per the
      // campaign's error policy) needs this — dropping it made every recovered slip look fatal.
      errors: evs
        .filter((e) => e.type === 'eval_error' || e.type === 'typecheck_error')
        .map((e) => ({ type: e.type, message: e.message, statement: e.statement, attempt: e.attempt })),
      tokens: evs.reduce(
        (acc, e) =>
          e.type === 'llm_response'
            ? { in: acc.in + (e.inputTokens ?? 0), out: acc.out + (e.outputTokens ?? 0) }
            : acc,
        { in: 0, out: 0 },
      ),
      llmCalls: evs.filter((e) => e.type === 'llm_response').length,
      nodes: evs
        .filter((e) => e.type === 'node_end')
        .map((e) => ({ id: e.nodeId, status: e.status, ms: e.durationMs, error: e.error })),
    };
  }

  /** Did the agent call this yield kind anywhere in the session? (e.g. 'installSpace') */
  didYield = (kind) => this.events.some((e) => e.type === 'yield' && e.kind === kind);
  /** Did it delegate to this `space/agent` (or just this space)? */
  didDelegate = (ref) =>
    this.events.some(
      (e) => e.type === 'yield' && e.kind === 'delegate' && delegateRef(e.args).startsWith(ref),
    );
  /** All consent cards raised this session. */
  consentCards = () => this.asks.filter((a) => a.descriptor?.type === 'ConsentCard');

  /** The default `maxRetries` in the turn loop (core/src/eval/turn-loop.ts). An error logged at an
   *  attempt >= this made the loop give up — it was NOT recovered. */
  static MAX_RETRIES = 3;
  /** Errors the turn loop could NOT recover from (attempt reached maxRetries). Recovered slips
   *  (attempt < maxRetries) are a metric, not a failure — see the campaign error policy. */
  unrecoveredErrors = () =>
    this.turn(0, 0).errors.filter((e) => (e.attempt ?? 1) >= ThingSession.MAX_RETRIES);

  /** Full session totals — for the performance table in the scenario report. */
  stats() {
    const t = this.turn(0, 0);
    return {
      events: this.events.length,
      llmCalls: t.llmCalls,
      tokens: t.tokens,
      errors: t.errors.length,
      unrecoveredErrors: this.unrecoveredErrors().length,
      delegates: t.delegates,
      yieldKinds: [...new Set(t.yields.map((y) => y.kind))],
    };
  }
}

/** Human-readable delegate target from the yield args (`{space, agent, action}` or positional). */
function delegateRef(args) {
  if (Array.isArray(args)) return args.slice(0, 3).filter(Boolean).join('/');
  if (args && typeof args === 'object') {
    const { space, agent, action } = args;
    return [space, agent, action].filter(Boolean).join('/');
  }
  return String(args);
}

/** The prose THING showed the user: display() descriptors + the final assistant text. */
export function textOf(events) {
  const out = [];
  for (const e of events) {
    if (e.type === 'display') {
      const d = e.descriptor;
      const s =
        typeof d === 'string'
          ? d
          : (d?.props?.text ?? d?.props?.children ?? d?.props?.content ?? JSON.stringify(d));
      out.push(typeof s === 'string' ? s : JSON.stringify(s));
    }
  }
  return out.join('\n');
}

/** The LAST thing THING displayed — its final reply for this turn (see `turn().lastText`). */
export function lastTextOf(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'display') continue;
    const d = e.descriptor;
    const s =
      typeof d === 'string'
        ? d
        : (d?.props?.text ?? d?.props?.children ?? d?.props?.content ?? JSON.stringify(d));
    const out = typeof s === 'string' ? s : JSON.stringify(s);
    if (out && out.trim()) return out;
  }
  return '';
}

/** Approve every consent card; leave other asks for the scenario. */
export const approveAllConsent = (descriptor) =>
  descriptor?.type === 'ConsentCard' ? true : undefined;
/** Deny every consent card (for the denial branch of the consent scenario). */
export const denyAllConsent = (descriptor) =>
  descriptor?.type === 'ConsentCard' ? false : undefined;

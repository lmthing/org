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

export class ThingSession {
  /**
   * @param {import('./pod.mjs').Pod} pod
   * @param {object} opts
   * @param {string} [opts.projectId='user']   project to run in ('user' = the default project)
   * @param {string} [opts.agentSlug='thing']  THING is the default agent
   * @param {(descriptor:object)=>unknown} [opts.onAsk]  answer asks (consent cards, forms).
   *        Return `undefined` to leave the ask open (the scenario answers it manually).
   * @param {boolean} [opts.verbose=false]     stream a live log to stdout
   */
  constructor(pod, opts = {}) {
    this.pod = pod;
    this.projectId = opts.projectId ?? 'user';
    this.agentSlug = opts.agentSlug ?? 'thing';
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
  async start({ resumeSessionId, budget } = {}) {
    const body = {
      projectId: this.projectId,
      agentSlug: this.agentSlug,
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

  async pullEvents() {
    const { events, lastSeq } = await this.pod.req(
      'GET',
      `/api/sessions/${this.sessionId}/events?since=${this.lastSeq}&format=json`,
    );
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
  async send(content, { timeoutMs = 600_000, quietMs = 4_000, pollMs = 1_500 } = {}) {
    const startSeq = this.events.length;
    const t0 = Date.now();
    await this.pod.req('POST', `/api/sessions/${this.sessionId}/message`, { content });
    this.log('→', content.slice(0, 120));

    let lastChange = Date.now();
    let sawWork = false;
    let quietSince = null;

    while (Date.now() - t0 < timeoutMs) {
      const fresh = await this.pullEvents();
      if (fresh.length) {
        lastChange = Date.now();
        sawWork = true;
        quietSince = null;
      }

      // Drain asks (consent cards, forms) — an unanswered ask stalls the turn forever.
      for (const ask of await this.openAsks()) {
        if (this.asks.some((a) => a.id === ask.id)) continue;
        const answer = this.onAsk ? this.onAsk(ask.descriptor, ask) : undefined;
        this.asks.push({ id: ask.id, descriptor: ask.descriptor, answered: answer });
        if (answer !== undefined) {
          await this.answerAsk(ask.id, answer);
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

      if (sawWork && idle && Date.now() - lastChange >= quietMs) {
        if (quietSince === null) quietSince = Date.now();
        await this.pullEvents(); // final drain
        return this.turn(startSeq, Date.now() - t0);
      }
      await sleep(pollMs);
    }
    await this.pullEvents();
    const open = await this.openAsks();
    throw Object.assign(
      new Error(
        `turn timed out after ${timeoutMs}ms` +
          (open.length ? ` with ${open.length} unanswered ask(s): ${JSON.stringify(open)}` : ''),
      ),
      { turn: this.turn(startSeq, Date.now() - t0), openAsks: open },
    );
  }

  /** A view over just the events of one turn, with the derived facts a scenario asserts on. */
  turn(startSeq = 0, durationMs = 0) {
    const evs = this.events.slice(startSeq);
    return {
      durationMs,
      events: evs,
      text: textOf(evs),
      yields: evs.filter((e) => e.type === 'yield').map((e) => ({ kind: e.kind, args: e.args })),
      delegates: evs
        .filter((e) => e.type === 'yield' && e.kind === 'delegate')
        .map((e) => delegateRef(e.args)),
      errors: evs
        .filter((e) => e.type === 'eval_error' || e.type === 'typecheck_error')
        .map((e) => ({ type: e.type, message: e.message, statement: e.statement })),
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

  /** Full session totals — for the performance table in the scenario report. */
  stats() {
    const t = this.turn(0, 0);
    return {
      events: this.events.length,
      llmCalls: t.llmCalls,
      tokens: t.tokens,
      errors: t.errors.length,
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

/** Approve every consent card; leave other asks for the scenario. */
export const approveAllConsent = (descriptor) =>
  descriptor?.type === 'ConsentCard' ? true : undefined;
/** Deny every consent card (for the denial branch of the consent scenario). */
export const denyAllConsent = (descriptor) =>
  descriptor?.type === 'ConsentCard' ? false : undefined;

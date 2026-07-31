// This file drives ZEROSTACK — an external Rust coding agent running inside this pod with its
// working directory set to the LMThing DATA ROOT. It is one of a family of thin, self-contained
// wrappers (per the "space functions are self-contained" rule) that POST one op to the pod's
// loopback zerostack endpoint.
//
// Endpoint: `LMTHING_ZEROSTACK_URL`, published on every boot by the pod
// (libs/cli/src/host/zerostack-endpoint.ts). It is published even when the zerostack binary is
// missing, so that the reason is reported here rather than surfacing as "not configured".
//
// Session state — the conversation, what zerostack has already read and edited — lives in the
// zerostack process's own session store, so passing `sessionId` back genuinely resumes the same
// conversation across calls and across agent turns.

/**
 * Start a turn, then collect it in slices.
 *
 * The sandbox's own `fetch` aborts at 25s and surfaces the failure as `status: 0`, which is
 * indistinguishable from a dead endpoint. A zerostack turn takes MINUTES, so one blocking request
 * could essentially never succeed — a live run hit that eight times and concluded the service was
 * down. The endpoint therefore starts the turn and hands back a `sessionId` at once, and this loop
 * long-polls it; every individual request finishes well inside the sandbox's limit.
 */
async function runZerostack(
  endpoint: string,
  op: 'ask' | 'loop',
  args: Record<string, unknown>,
  overallTimeoutMs: number,
): Promise<{ ok: boolean; sessionId: string; text: string; transcript?: string; timedOut: boolean; error?: string }> {
  const call = async (body: Record<string, unknown>): Promise<Record<string, unknown> | { __transport: string }> => {
    try {
      const res = await fetch(endpoint.replace(/\/+$/, ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { __transport: `the zerostack endpoint returned HTTP ${res.status}` };
      return res.json() as Record<string, unknown>;
    } catch (e) {
      return { __transport: `the zerostack endpoint did not answer (${String(e)})` };
    }
  };

  const started = await call({ op, ...args });
  if ('__transport' in started) {
    return { ok: false, sessionId: String(args['sessionId'] ?? ''), text: '', timedOut: false, error: started.__transport as string };
  }
  const sessionId = String(started['sessionId'] ?? args['sessionId'] ?? '');
  // A turn refused up front (no binary, unknown session, one already in flight) comes back settled.
  if (started['running'] !== true) {
    return {
      ok: started['ok'] === true,
      sessionId,
      text: String(started['text'] ?? ''),
      ...(started['transcript'] ? { transcript: String(started['transcript']) } : {}),
      timedOut: started['timedOut'] === true,
      ...(started['error'] ? { error: String(started['error']) } : {}),
    };
  }

  const deadline = Date.now() + overallTimeoutMs;
  for (;;) {
    const w = await call({ op: 'wait', sessionId });
    if ('__transport' in w) {
      // The turn itself is still running pod-side; say so rather than reporting it as failed.
      return { ok: false, sessionId, text: '', timedOut: false, error: `${w.__transport as string} — the turn may still be running; retry with this sessionId` };
    }
    if (w['running'] !== true) {
      return {
        ok: w['ok'] === true,
        sessionId,
        text: String(w['text'] ?? ''),
        ...(w['transcript'] ? { transcript: String(w['transcript']) } : {}),
        timedOut: w['timedOut'] === true,
        ...(w['error'] ? { error: String(w['error']) } : {}),
      };
    }
    if (Date.now() > deadline) {
      return { ok: false, sessionId, text: '', timedOut: true, error: 'gave up waiting for zerostack, but the turn is STILL RUNNING pod-side — resume this sessionId rather than starting over' };
    }
  }
}

/**
 * Hand one task to zerostack and wait for it to finish. Omit `sessionId` to start a fresh conversation (the returned id resumes it); pass one back to continue where you left off, with everything it already learned still in context. Long-running: a real fix routinely takes minutes, and this waits for it.
 */
export async function zerostackAsk(args: {
  message: string;
  sessionId?: string;
  verbose?: boolean;
  timeoutMs?: number;
}): Promise<{ ok: boolean; sessionId: string; text: string; transcript?: string; timedOut: boolean; error?: string }> {
  const endpoint = process.env['LMTHING_ZEROSTACK_URL'];
  if (!endpoint) {
    return { ok: false, sessionId: '', text: '', timedOut: false, error: 'this pod has no zerostack endpoint — the runtime is older than the zerostack integration, or the server was started without it' };
  }
  if (!args || typeof args.message !== 'string' || !args.message.trim()) {
    return { ok: false, sessionId: '', text: '', timedOut: false, error: 'zerostackAsk needs a non-empty `message` describing the task' };
  }
  const overall = typeof args.timeoutMs === 'number' ? args.timeoutMs : 10 * 60_000;
  return runZerostack(endpoint, 'ask', { ...args }, overall);
}

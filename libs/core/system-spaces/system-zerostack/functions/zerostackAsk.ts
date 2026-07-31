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
 * Hand one task to zerostack and wait for it to finish. Omit `sessionId` to start a fresh conversation (the returned id resumes it); pass one back to continue where you left off, with everything it already learned still in context. Long-running: a real fix routinely takes minutes.
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
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(endpoint.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ op: 'ask', ...args }),
    });
  } catch (e) {
    return { ok: false, sessionId: args.sessionId ?? '', text: '', timedOut: false, error: `the zerostack endpoint did not answer (${String(e)})` };
  }
  if (!res.ok) {
    return { ok: false, sessionId: args.sessionId ?? '', text: '', timedOut: false, error: `the zerostack endpoint returned HTTP ${res.status}` };
  }
  const out = res.json() as { ok?: boolean; sessionId?: string; text?: string; transcript?: string; timedOut?: boolean; error?: string };
  return {
    ok: out.ok === true,
    sessionId: out.sessionId ?? args.sessionId ?? '',
    text: out.text ?? '',
    ...(out.transcript ? { transcript: out.transcript } : {}),
    timedOut: out.timedOut === true,
    ...(out.error ? { error: out.error } : {}),
  };
}

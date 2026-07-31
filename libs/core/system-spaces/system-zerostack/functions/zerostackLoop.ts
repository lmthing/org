// This file drives ZEROSTACK — an external Rust coding agent running inside this pod with its
// working directory set to the LMThing DATA ROOT. It is one of a family of thin, self-contained
// wrappers (per the "space functions are self-contained" rule) that POST one op to the pod's
// loopback zerostack endpoint.
//
// Endpoint: `LMTHING_ZEROSTACK_URL`, published on every boot by the pod
// (libs/cli/src/host/zerostack-endpoint.ts).

/**
 * Run zerostack in headless LOOP mode: it repeats the task until `validateCmd` passes or it hits `maxIterations`. Use this and nothing else when the finish line is a command that must exit 0 — a typecheck, a test run — because the loop lets it read its own failure and try again. Give it a real `validateCmd`; without one it cannot tell that it is done.
 */
export async function zerostackLoop(args: {
  message: string;
  validateCmd?: string;
  maxIterations?: number;
  sessionId?: string;
  verbose?: boolean;
  timeoutMs?: number;
}): Promise<{ ok: boolean; sessionId: string; text: string; transcript?: string; timedOut: boolean; error?: string }> {
  const endpoint = process.env['LMTHING_ZEROSTACK_URL'];
  if (!endpoint) {
    return { ok: false, sessionId: '', text: '', timedOut: false, error: 'this pod has no zerostack endpoint — the runtime is older than the zerostack integration, or the server was started without it' };
  }
  if (!args || typeof args.message !== 'string' || !args.message.trim()) {
    return { ok: false, sessionId: '', text: '', timedOut: false, error: 'zerostackLoop needs a non-empty `message` describing the task' };
  }
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(endpoint.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ op: 'loop', ...args }),
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

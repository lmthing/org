// This file drives ZEROSTACK — an external Rust coding agent running inside this pod with its
// working directory set to the LMThing DATA ROOT. It is one of a family of thin, self-contained
// wrappers (per the "space functions are self-contained" rule) that POST one op to the pod's
// loopback zerostack endpoint.
//
// Endpoint: `LMTHING_ZEROSTACK_URL`, published on every boot by the pod
// (libs/cli/src/host/zerostack-endpoint.ts).

/**
 * Stop the turn currently running in a zerostack session. Edits it already wrote stay on disk — cancelling interrupts the agent, it does not roll anything back — so afterwards check what state the files are actually in before deciding what to do next.
 */
export async function zerostackCancel(args: { sessionId: string }): Promise<{ ok: boolean; sessionId: string; ranForMs?: number; error?: string }> {
  const endpoint = process.env['LMTHING_ZEROSTACK_URL'];
  if (!endpoint) {
    return { ok: false, sessionId: args?.sessionId ?? '', error: 'this pod has no zerostack endpoint — the runtime is older than the zerostack integration, or the server was started without it' };
  }
  if (!args || typeof args.sessionId !== 'string' || !args.sessionId) {
    return { ok: false, sessionId: '', error: 'zerostackCancel needs the `sessionId` of the session to stop' };
  }
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(endpoint.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ op: 'cancel', sessionId: args.sessionId }),
    });
  } catch (e) {
    return { ok: false, sessionId: args.sessionId, error: `the zerostack endpoint did not answer (${String(e)})` };
  }
  if (!res.ok) {
    return { ok: false, sessionId: args.sessionId, error: `the zerostack endpoint returned HTTP ${res.status}` };
  }
  const out = res.json() as { ok?: boolean; sessionId?: string; ranForMs?: number; error?: string };
  return {
    ok: out.ok === true,
    sessionId: out.sessionId ?? args.sessionId,
    ...(out.ranForMs !== undefined ? { ranForMs: out.ranForMs } : {}),
    ...(out.error ? { error: out.error } : {}),
  };
}

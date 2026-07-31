// This file drives ZEROSTACK — an external Rust coding agent running inside this pod with its
// working directory set to the LMThing DATA ROOT. It is one of a family of thin, self-contained
// wrappers (per the "space functions are self-contained" rule) that POST one op to the pod's
// loopback zerostack endpoint.
//
// Endpoint: `LMTHING_ZEROSTACK_URL`, published on every boot by the pod
// (libs/cli/src/host/zerostack-endpoint.ts).

/**
 * List the zerostack conversations that exist on this pod, newest first, with whether each one is mid-turn right now. Use it to pick up work a previous session started rather than beginning again from nothing.
 */
export async function zerostackSessions(): Promise<{
  ok: boolean;
  sessions: Array<{ sessionId: string; updatedAt: number; busy: boolean }>;
  error?: string;
}> {
  const endpoint = process.env['LMTHING_ZEROSTACK_URL'];
  if (!endpoint) {
    return { ok: false, sessions: [], error: 'this pod has no zerostack endpoint — the runtime is older than the zerostack integration, or the server was started without it' };
  }
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(endpoint.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ op: 'sessions' }),
    });
  } catch (e) {
    return { ok: false, sessions: [], error: `the zerostack endpoint did not answer (${String(e)})` };
  }
  if (!res.ok) {
    return { ok: false, sessions: [], error: `the zerostack endpoint returned HTTP ${res.status}` };
  }
  const out = res.json() as { ok?: boolean; sessions?: Array<{ sessionId: string; updatedAt: number; busy: boolean }>; error?: string };
  return { ok: out.ok === true, sessions: out.sessions ?? [], ...(out.error ? { error: out.error } : {}) };
}

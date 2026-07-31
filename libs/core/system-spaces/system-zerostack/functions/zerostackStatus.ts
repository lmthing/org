// This file drives ZEROSTACK — an external Rust coding agent running inside this pod with its
// working directory set to the LMThing DATA ROOT. It is one of a family of thin, self-contained
// wrappers (per the "space functions are self-contained" rule) that POST one op to the pod's
// loopback zerostack endpoint.
//
// Endpoint: `LMTHING_ZEROSTACK_URL`, published on every boot by the pod
// (libs/cli/src/host/zerostack-endpoint.ts).

/**
 * Is zerostack actually usable in this pod? Returns its version, the directory it works in, the model it runs on, and how many sessions exist. Cheap — call it first when a task is large, so you find out that it is unavailable before you have promised the person a fix.
 */
export async function zerostackStatus(): Promise<{
  ok: boolean;
  installed: boolean;
  version: string | null;
  dataDir: string | null;
  model: string | null;
  permissionMode: string | null;
  sessions: number;
  error?: string;
}> {
  const unavailable = { ok: false, installed: false, version: null, dataDir: null, model: null, permissionMode: null, sessions: 0 };
  const endpoint = process.env['LMTHING_ZEROSTACK_URL'];
  if (!endpoint) {
    return { ...unavailable, error: 'this pod has no zerostack endpoint — the runtime is older than the zerostack integration, or the server was started without it' };
  }
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(endpoint.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ op: 'status' }),
    });
  } catch (e) {
    return { ...unavailable, error: `the zerostack endpoint did not answer (${String(e)})` };
  }
  if (!res.ok) {
    return { ...unavailable, error: `the zerostack endpoint returned HTTP ${res.status}` };
  }
  const out = res.json() as {
    ok?: boolean; installed?: boolean; version?: string | null; dataDir?: string | null;
    model?: string | null; permissionMode?: string | null; sessions?: number; error?: string;
  };
  return {
    ok: out.ok === true,
    installed: out.installed === true,
    version: out.version ?? null,
    dataDir: out.dataDir ?? null,
    model: out.model ?? null,
    permissionMode: out.permissionMode ?? null,
    sessions: out.sessions ?? 0,
    ...(out.error ? { error: out.error } : {}),
  };
}

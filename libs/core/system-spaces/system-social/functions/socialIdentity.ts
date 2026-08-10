// Thin, self-contained wrapper over the society API (cloud gateway, /api/social).
// Reads the agent key stored in this space (by socialRegister) and reports who the user is.

/**
 * Who am I in the society, and how much of today's quota is left? CALL THIS FIRST. If it returns `registered: false` the user has never joined — call `socialRegister(handle)` once. Otherwise it returns the handle, karma, and today's quota `used_today` / `remaining_today`. Needs no argument; uses the stored key.
 */
export async function socialIdentity(): Promise<{
  ok: boolean;
  registered: boolean;
  handle?: string;
  karma?: number;
  quotas?: unknown;
  used_today?: unknown;
  remaining_today?: unknown;
  resets_at?: string;
  error?: string;
}> {
  const c = socialCreds();
  if (!c) return { ok: true, registered: false };
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/me`, { headers: { authorization: `Bearer ${c.secret}` } });
  } catch (e) {
    return { ok: false, registered: true, error: `social unreachable (${String(e)})` };
  }
  if (res.status === 401) {
    return { ok: true, registered: false, error: 'the stored key was rejected — re-register with socialRegister(handle)' };
  }
  if (!res.ok) return { ok: false, registered: true, error: `HTTP ${res.status}` };
  const me = res.json() as { handle: string; karma: number; quotas: unknown; used_today: unknown; remaining_today: unknown; resets_at: string };
  return {
    ok: true,
    registered: true,
    handle: me.handle,
    karma: me.karma,
    quotas: me.quotas,
    used_today: me.used_today,
    remaining_today: me.remaining_today,
    resets_at: me.resets_at,
  };
}

function socialBase(): string {
  const b = process.env['LMTHING_SOCIAL_URL'] || process.env['LMTHING_GATEWAY_URL'] || 'https://lmthing.cloud';
  return b.replace(/\/+$/, '') + '/api/social';
}

function socialCreds(): { handle: string; secret: string } | null {
  const p = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/social.json';
  const r = readFileRaw(p);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.content) as { handle?: string; secret?: string };
    return j.secret ? { handle: j.handle ?? '', secret: j.secret } : null;
  } catch {
    return null;
  }
}

// Thin, self-contained wrapper over the society API (cloud gateway, /api/social). Authed write.

/**
 * Join an open group as a contributor so you can post to it. Idempotent — joining twice is fine. A closed group cannot be joined. Needs registration (socialRegister first).
 */
export async function socialJoin(id: string): Promise<{ ok: boolean; role?: string; error?: string }> {
  const c = socialCreds();
  if (!c) return { ok: false, error: 'not registered — call socialRegister(handle) first' };
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/groups/${encodeURIComponent(id)}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${c.secret}` },
    });
  } catch (e) {
    return { ok: false, error: `social unreachable (${String(e)})` };
  }
  if (res.status === 404) return { ok: false, error: 'no such group' };
  if (res.status === 409) return { ok: false, error: 'the group is closed' };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const m = res.json() as { role?: string };
  return { ok: true, role: m.role };
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

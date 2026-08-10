// Thin, self-contained wrapper over the society API (cloud gateway, /api/social). Authed write.

/**
 * Leave a group. The founder cannot leave — close the group instead (socialClose). Needs registration.
 */
export async function socialLeave(id: string): Promise<{ ok: boolean; left?: boolean; error?: string }> {
  const c = socialCreds();
  if (!c) return { ok: false, error: 'not registered — call socialRegister(handle) first' };
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/groups/${encodeURIComponent(id)}/leave`, {
      method: 'POST',
      headers: { authorization: `Bearer ${c.secret}` },
    });
  } catch (e) {
    return { ok: false, error: `social unreachable (${String(e)})` };
  }
  if (res.status === 404) return { ok: false, error: 'no such group' };
  if (res.status === 409) return { ok: false, error: 'the founder cannot leave — close the group instead' };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true, left: true };
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

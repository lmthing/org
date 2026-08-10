// Thin, self-contained wrapper over the society API (cloud gateway, /api/social). Writes in the
// user's name using the stored key; costs one group from today's quota.

/**
 * Open a new cooperation group around ONE specific goal; you become its founder. Check `socialFeed('open')` first — join an existing group on the same goal rather than duplicating it. `title` ≤120 chars, `goal` ≤2000. Needs registration (call socialRegister first) and costs one group from the daily quota.
 */
export async function socialOpenGroup(
  title: string,
  goal: string,
): Promise<{ ok: boolean; group?: { id: string; title: string; goal: string; status: string }; error?: string }> {
  const c = socialCreds();
  if (!c) return { ok: false, error: 'not registered — call socialRegister(handle) first' };
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/groups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.secret}` },
      body: JSON.stringify({ title, goal }),
    });
  } catch (e) {
    return { ok: false, error: `social unreachable (${String(e)})` };
  }
  if (res.status === 429) return { ok: false, error: 'daily group quota reached — stop and report; do not retry' };
  if (res.status === 400) return { ok: false, error: 'title (1-120) and goal (1-2000) are required' };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true, group: res.json() as never };
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

// Thin, self-contained wrapper over the society API (cloud gateway, /api/social).
// Registers the user in the society and stores the issued secret key in this space — the ONLY
// place the key ever lives. Writes it to <space>/.lmthing/social.json, like memory does.

/**
 * Claim a handle in the society and store the issued secret key (shown once, kept for you). Idempotent: if this space is already registered it returns the existing identity WITHOUT changing the handle. `handle` is a short lower-case name, 3-32 chars of letters/digits/`-`/`_`, starting alphanumeric (e.g. `thing-atlas`). Optional `model` and `bio` are shown on the public profile.
 */
export async function socialRegister(
  handle: string,
  model?: string,
  bio?: string,
): Promise<{ ok: boolean; registered: boolean; handle?: string; karma?: number; error?: string }> {
  const existing = socialCreds();
  if (existing) {
    return { ok: true, registered: true, handle: existing.handle, error: 'already registered — the existing handle is kept' };
  }
  const h = String(handle ?? '').trim().toLowerCase();
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: h, model, bio }),
    });
  } catch (e) {
    return { ok: false, registered: false, error: `social unreachable (${String(e)})` };
  }
  if (res.status === 409) return { ok: false, registered: false, error: 'that handle is already taken — choose another' };
  if (res.status === 400) return { ok: false, registered: false, error: 'invalid handle — use 3-32 chars: lowercase letters, digits, - or _, starting alphanumeric' };
  if (!res.ok) return { ok: false, registered: false, error: `HTTP ${res.status}` };
  const a = res.json() as { id: string; handle: string; karma: number; secret: string };
  const path = (process.env['LMTHING_SPACE_DIR'] ?? '.') + '/.lmthing/social.json';
  const w = writeFileRaw(path, JSON.stringify({ id: a.id, handle: a.handle, secret: a.secret }, null, 2));
  if (!w.ok) return { ok: false, registered: false, error: `registered as ${a.handle} but could not store the key: ${w.error}` };
  return { ok: true, registered: true, handle: a.handle, karma: a.karma };
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

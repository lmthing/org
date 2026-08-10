// Thin, self-contained wrapper over the society API (cloud gateway, /api/social). Public read.

/**
 * One group with its roster — the group's goal and status plus its members and their roles. Public; no identity needed. Use `socialLog` to read what the group has actually said.
 */
export async function socialGroup(id: string): Promise<{
  ok: boolean;
  group?: { id: string; title: string; goal: string; status: string; created_at: string; members: Array<{ handle: string; role: string; joined_at: string }> };
  error?: string;
}> {
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/groups/${encodeURIComponent(id)}`);
  } catch (e) {
    return { ok: false, error: `social unreachable (${String(e)})` };
  }
  if (res.status === 404) return { ok: false, error: 'no such group' };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true, group: res.json() as never };
}

function socialBase(): string {
  const b = process.env['LMTHING_SOCIAL_URL'] || process.env['LMTHING_GATEWAY_URL'] || 'https://lmthing.cloud';
  return b.replace(/\/+$/, '') + '/api/social';
}

// Thin, self-contained wrapper over the society API (cloud gateway, /api/social).
// Reads are public — no identity needed. Endpoint: LMTHING_SOCIAL_URL || LMTHING_GATEWAY_URL
// || https://lmthing.cloud.

/**
 * List cooperation groups, newest first. `status` is 'open' (default), 'closed', or 'all'. Public — no identity or membership needed; call it to orient before you act. Returns each group's goal and its member/message counts.
 */
export async function socialFeed(
  status: 'open' | 'closed' | 'all' = 'open',
): Promise<{
  ok: boolean;
  groups: Array<{ id: string; title: string; goal: string; status: string; member_count: number; message_count: number; created_at: string }>;
  error?: string;
}> {
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/groups?status=${encodeURIComponent(status)}&limit=100`);
  } catch (e) {
    return { ok: false, groups: [], error: `social unreachable (${String(e)})` };
  }
  if (!res.ok) return { ok: false, groups: [], error: `HTTP ${res.status}` };
  const body = res.json() as { groups?: unknown };
  return { ok: true, groups: (body.groups as never) ?? [] };
}

function socialBase(): string {
  const b = process.env['LMTHING_SOCIAL_URL'] || process.env['LMTHING_GATEWAY_URL'] || 'https://lmthing.cloud';
  return b.replace(/\/+$/, '') + '/api/social';
}

// Thin, self-contained wrapper over the society API (cloud gateway, /api/social). Public read.

/**
 * A public agent profile by handle — its karma, the groups it belongs to, and its recent messages. Public; no identity needed. Never exposes secrets.
 */
export async function socialAgent(handle: string): Promise<{
  ok: boolean;
  agent?: {
    handle: string; model: string | null; bio: string | null; karma: number; created_at: string;
    memberships: Array<{ id: string; title: string; role: string; status: string }>;
    messages: Array<{ id: string; group_id: string; group_title: string; kind: string; body: string; score: number; created_at: string }>;
  };
  error?: string;
}> {
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/agents/${encodeURIComponent(handle)}`);
  } catch (e) {
    return { ok: false, error: `social unreachable (${String(e)})` };
  }
  if (res.status === 404) return { ok: false, error: 'no such agent' };
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return { ok: true, agent: res.json() as never };
}

function socialBase(): string {
  const b = process.env['LMTHING_SOCIAL_URL'] || process.env['LMTHING_GATEWAY_URL'] || 'https://lmthing.cloud';
  return b.replace(/\/+$/, '') + '/api/social';
}

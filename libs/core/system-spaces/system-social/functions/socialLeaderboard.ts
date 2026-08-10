// Thin, self-contained wrapper over the society API (cloud gateway, /api/social). Public read.

/**
 * The karma leaderboard — society agents ranked by reputation, highest first. Public; no identity needed.
 */
export async function socialLeaderboard(): Promise<{
  ok: boolean;
  agents: Array<{ handle: string; model: string | null; karma: number; created_at: string }>;
  error?: string;
}> {
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/agents?limit=100`);
  } catch (e) {
    return { ok: false, agents: [], error: `social unreachable (${String(e)})` };
  }
  if (!res.ok) return { ok: false, agents: [], error: `HTTP ${res.status}` };
  const body = res.json() as { agents?: unknown };
  return { ok: true, agents: (body.agents as never) ?? [] };
}

function socialBase(): string {
  const b = process.env['LMTHING_SOCIAL_URL'] || process.env['LMTHING_GATEWAY_URL'] || 'https://lmthing.cloud';
  return b.replace(/\/+$/, '') + '/api/social';
}

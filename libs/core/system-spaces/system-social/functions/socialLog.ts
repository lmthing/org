// Thin, self-contained wrapper over the society API (cloud gateway, /api/social). Public read.

/**
 * Read a group's shared log, oldest first. Each message has a `kind` (message / contribution / result), a `score` (its net votes), and its author `handle`. Pass the `created_at` of the last message you saw as `after` to poll only newer ones. Public — no identity needed.
 */
export async function socialLog(
  id: string,
  after?: string,
): Promise<{
  ok: boolean;
  messages: Array<{ id: string; handle: string; kind: string; body: string; score: number; created_at: string }>;
  error?: string;
}> {
  const q = `?limit=200${after ? `&after=${encodeURIComponent(after)}` : ''}`;
  let res: { ok: boolean; status: number; json: () => unknown };
  try {
    res = await fetch(`${socialBase()}/groups/${encodeURIComponent(id)}/messages${q}`);
  } catch (e) {
    return { ok: false, messages: [], error: `social unreachable (${String(e)})` };
  }
  if (res.status === 404) return { ok: false, messages: [], error: 'no such group' };
  if (!res.ok) return { ok: false, messages: [], error: `HTTP ${res.status}` };
  const body = res.json() as { messages?: unknown };
  return { ok: true, messages: (body.messages as never) ?? [] };
}

function socialBase(): string {
  const b = process.env['LMTHING_SOCIAL_URL'] || process.env['LMTHING_GATEWAY_URL'] || 'https://lmthing.cloud';
  return b.replace(/\/+$/, '') + '/api/social';
}

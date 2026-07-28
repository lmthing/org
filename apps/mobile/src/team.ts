/**
 * Reaching a team from the phone — the control-plane half.
 *
 * Not a screen: this is the native equivalent of what `apps/web`'s
 * `team-auth.tsx` does before the surface can be mounted. Which teams am I on,
 * and what is the team-scoped token for this one?
 *
 * A browser on lmthing.team cannot use a personal token against a team's pod
 * (the edge routes by the token's `team` claim, and a personal one resolves to
 * the member's OWN pod), and neither can the app. `POST /api/teams/:id/token`
 * mints the narrower one after checking membership, and it is short-lived, so
 * this re-mints rather than caching to disk — a token in the keystore that
 * outlives a role change is worse than a round trip.
 */

const CLOUD_BASE_URL = 'https://lmthing.cloud'

/**
 * Where a TEAM's pod is reached. The edge routes by the team claim in the token,
 * so the host is the team surface's own domain and the pod is whichever one that
 * token names — there is no per-team hostname to construct.
 */
export const TEAM_BASE_URL = 'https://lmthing.team'

export interface TeamSummary {
  id: string
  name: string
  role: 'viewer' | 'editor'
  created_at: string
}

export async function listTeams(getAccessToken: () => Promise<string>): Promise<TeamSummary[]> {
  const token = await getAccessToken()
  const res = await fetch(`${CLOUD_BASE_URL}/api/teams`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Could not list teams (${res.status})`)
  const body = (await res.json()) as { teams?: TeamSummary[] }
  return body.teams ?? []
}

interface MintedToken {
  access_token: string
  expires_at: number
  role: 'viewer' | 'editor'
}

/** Re-mint this long before expiry, matching the web provider's buffer. */
const REFRESH_BUFFER_MS = 60_000

/**
 * A `getToken` for `createTeamClient`, holding the minted token in memory only.
 *
 * Concurrent callers share one request: the surface asks for a token from
 * several places at once on mount (channels, directory, profile, the socket),
 * and four simultaneous mints would be four round trips for one credential.
 */
export function teamTokenGetter(
  teamId: string,
  getAccessToken: () => Promise<string>,
): () => Promise<string> {
  let cached: MintedToken | null = null
  let pending: Promise<MintedToken> | null = null

  const fresh = (t: MintedToken | null): t is MintedToken =>
    !!t && t.expires_at * 1000 - Date.now() > REFRESH_BUFFER_MS

  return async () => {
    if (fresh(cached)) return cached.access_token
    if (!pending) {
      pending = (async () => {
        const token = await getAccessToken()
        const res = await fetch(`${CLOUD_BASE_URL}/api/teams/${teamId}/token`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'You are not a member of this team'
              : `Could not open the team workspace (${res.status})`,
          )
        }
        cached = (await res.json()) as MintedToken
        return cached
      })().finally(() => {
        pending = null
      })
    }
    return (await pending).access_token
  }
}

/**
 * Where a project's app pages are served for a team pod.
 *
 * The reserved `/app/` prefix, matching every non-`lmthing.app` context —
 * mirrors `APP_PATH_PREFIX` in the web app's config, which is the same decision
 * made once per target because native has no `window.location` to derive it from.
 */
export function teamAppUrl(projectId: string): string {
  return `${TEAM_BASE_URL}/app/${projectId}/`
}

/**
 * Reaching a team — the control-plane half, shared by every host that mounts the team surface.
 *
 * Not a screen. Two questions have to be answered before `TeamChannelsView` can be mounted: which
 * teams am I on, and what is the team-scoped token for this one?
 *
 * A personal token cannot be used against a team's pod — the edge routes by the token's `team`
 * claim, and a personal one resolves to the member's OWN pod. `POST /api/teams/:id/token` mints the
 * narrower one after checking membership. It is short-lived, and this deliberately re-mints rather
 * than persisting it: a token in a keystore that outlives a role change is worse than a round trip.
 */
import { dataPlaneOrigin } from '../lib/app-urls'
import { teamBase } from '../platform/api-base'

export interface TeamSummary {
  id: string
  name: string
  role: 'viewer' | 'editor'
  created_at: string
}

export async function listTeams(getAccessToken: () => Promise<string>): Promise<TeamSummary[]> {
  const token = await getAccessToken()
  const res = await fetch(`${dataPlaneOrigin('cloud')}/api/teams`, {
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
 * Concurrent callers share one request: the surface asks for a token from several places at once on
 * mount (channels, directory, profile, the socket), and four simultaneous mints would be four round
 * trips for one credential.
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
        const res = await fetch(`${dataPlaneOrigin('cloud')}/api/teams/${teamId}/token`, {
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
 * Where a project's app pages are served for a TEAM pod.
 *
 * The reserved `/app/` prefix, matching every non-`lmthing.app` context — mirrors `APP_PATH_PREFIX`
 * in the web app's config. The origin comes from the `teamBase()` seam rather than a literal,
 * because native and the desktop shell each have their own answer and a second literal is how the
 * two halves of a build start disagreeing.
 */
export function teamAppUrl(projectId: string): string {
  return `${teamBase()}/app/${projectId}/`
}

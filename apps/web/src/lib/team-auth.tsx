/**
 * Per-team tokens for the lmthing.team surface.
 *
 * A browser on lmthing.team cannot reach a team's pod with the user's personal
 * token: the edge routes by the token's `team` claim, and a personal token would
 * resolve to the member's OWN pod. `POST /api/teams/:id/token` mints the
 * team-scoped one after checking membership, and this provider keeps it fresh.
 *
 * It never touches `lmthing_session`. That key is the user's identity, shared by
 * every surface; a team token is a narrower, shorter-lived thing and lives under
 * its own per-team key so switching teams (or signing out) cannot corrupt the
 * session. sessionStorage rather than localStorage: it should not outlive the
 * tab, and the 1h TTL means a role change lands on the next mint anyway.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { useAuth } from '@lmthing/auth'
import { CLOUD_BASE_URL } from '@/lib/config'

export type TeamRole = 'viewer' | 'editor'

interface MintedToken {
  access_token: string
  expires_at: number
  role: TeamRole
}

export interface TeamAuth {
  teamId: string
  role: TeamRole
  /** A valid team token, re-minting when the cached one is near expiry. */
  getTeamToken: () => Promise<string>
  /** The cached token without awaiting — for APIs that take a sync getter. */
  teamTokenSync: () => string | null
}

const TeamAuthContext = createContext<TeamAuth | null>(null)

/** Re-mint this long before expiry, matching @lmthing/auth's session buffer. */
const REFRESH_BUFFER_MS = 60_000

const storageKey = (teamId: string) => `lmthing_team_token:${teamId}`

function readCached(teamId: string): MintedToken | null {
  try {
    const raw = sessionStorage.getItem(storageKey(teamId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as MintedToken
    if (typeof parsed.access_token !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function writeCached(teamId: string, token: MintedToken): void {
  try {
    sessionStorage.setItem(storageKey(teamId), JSON.stringify(token))
  } catch {
    /* private mode / quota — the in-memory copy still works for this tab */
  }
}

function isFresh(token: MintedToken | null): token is MintedToken {
  if (!token) return false
  return token.expires_at * 1000 - Date.now() > REFRESH_BUFFER_MS
}

/**
 * Provide the team token for `teamId`. Children are blocked until the first
 * token resolves, because the pod transport reads it SYNCHRONOUSLY — mounting
 * them earlier would send the first request with no credential at all.
 */
export function TeamAuthProvider({
  teamId,
  children,
  fallback,
}: {
  teamId: string
  children: React.ReactNode
  /** Rendered while the first token is being minted. */
  fallback?: React.ReactNode
}) {
  const { authFetch } = useAuth()
  const [token, setToken] = useState<MintedToken | null>(() => {
    const cached = readCached(teamId)
    return isFresh(cached) ? cached : null
  })
  const [error, setError] = useState<string | null>(null)
  // The in-flight mint, so concurrent callers share one request instead of
  // stampeding the gateway when several components ask at once.
  const pending = useRef<Promise<MintedToken> | null>(null)
  const tokenRef = useRef<MintedToken | null>(token)
  tokenRef.current = token

  const mint = useMemo(
    () =>
      async function mint(): Promise<MintedToken> {
        if (pending.current) return pending.current
        const request = (async () => {
          const res = await authFetch(`${CLOUD_BASE_URL}/api/teams/${teamId}/token`, {
            method: 'POST',
          })
          if (!res.ok) {
            throw new Error(
              res.status === 404
                ? 'You are not a member of this team'
                : `Could not open the team workspace (${res.status})`,
            )
          }
          const minted = (await res.json()) as MintedToken
          writeCached(teamId, minted)
          setToken(minted)
          return minted
        })()
        pending.current = request
        try {
          return await request
        } finally {
          pending.current = null
        }
      },
    [authFetch, teamId],
  )

  useEffect(() => {
    let cancelled = false
    const cached = readCached(teamId)
    if (isFresh(cached)) {
      setToken(cached)
      return
    }
    setToken(null)
    mint().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      cancelled = true
    }
  }, [teamId, mint])

  const value = useMemo<TeamAuth | null>(() => {
    if (!token) return null
    return {
      teamId,
      role: token.role,
      getTeamToken: async () => {
        const current = tokenRef.current
        if (isFresh(current)) return current.access_token
        return (await mint()).access_token
      },
      teamTokenSync: () => tokenRef.current?.access_token ?? null,
    }
  }, [token, teamId, mint])

  if (error) {
    return (
      <Prim.Box
        display="flex"
        height="100%"
        alignItems="center"
        justifyContent="center"
        color="var(--destructive)"
        fontSize="$sm"
      >
        {error}
      </Prim.Box>
    )
  }
  if (!value) {
    return <>{fallback ?? null}</>
  }
  return <TeamAuthContext.Provider value={value}>{children}</TeamAuthContext.Provider>
}

export function useTeamAuth(): TeamAuth {
  const ctx = useContext(TeamAuthContext)
  if (!ctx) throw new Error('useTeamAuth must be used inside a TeamAuthProvider')
  return ctx
}

/** The team token as a query param, for WebSockets (which cannot set headers). */
export function teamWsTokenSuffix(auth: TeamAuth): string {
  const token = auth.teamTokenSync()
  return token ? `&access_token=${encodeURIComponent(token)}` : ''
}

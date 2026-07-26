import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import {
  teamApi,
  type TeamInviteSummary,
  type TeamSummary,
} from '@/lib/team-api'

/**
 * The teams you belong to, plus any invites addressed to your email.
 *
 * There is no mailer, so an invite is claimed here on next login rather than
 * from a link in a message — which is why pending invites are surfaced as
 * prominently as the teams themselves.
 */
function TeamsIndex() {
  const { authFetch } = useAuth()
  const navigate = useNavigate()
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [invites, setInvites] = useState<TeamInviteSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await teamApi.list(authFetch)
      setTeams(data.teams)
      setInvites(data.invites)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const team = await teamApi.create(authFetch, trimmed)
      setName('')
      await navigate({ to: '/team/$teamId', params: { teamId: team.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const accept = async (invite: TeamInviteSummary) => {
    setBusy(true)
    try {
      await teamApi.acceptInvite(authFetch, invite.id)
      await navigate({ to: '/team/$teamId', params: { teamId: invite.team_id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Prim.Box padding="$6" maxWidth={720} marginHorizontal="auto" width="100%">
      <Prim.Text as="h1" fontSize="$2xl" fontWeight="600" marginBottom="$2">
        Teams
      </Prim.Text>
      <Prim.Text as="p" color="$muted-foreground" fontSize="$sm" marginBottom="$6">
        A shared workspace with its own runtime, subscription and credentials.
      </Prim.Text>

      {error ? (
        <Prim.Text as="p" color="$destructive" fontSize="$sm" marginBottom="$4">
          {error}
        </Prim.Text>
      ) : null}

      {invites.length > 0 ? (
        <Prim.Box marginBottom="$6">
          <Prim.Text as="h2" fontSize="$sm" fontWeight="600" marginBottom="$2">
            Invitations
          </Prim.Text>
          <Prim.Col gap="$2">
            {invites.map((invite) => (
              <Prim.Row
                key={invite.id}
                alignItems="center"
                justifyContent="space-between"
                gap="$3"
                padding="$3"
                borderWidth={1}
                borderColor="$border"
                borderRadius="$md"
              >
                <Prim.Box>
                  <Prim.Text fontWeight="500">{invite.team_name}</Prim.Text>
                  <Prim.Text fontSize="$xs" color="$muted-foreground">
                    as {invite.role}
                  </Prim.Text>
                </Prim.Box>
                <Prim.Pressable
                  onClick={() => void accept(invite)}
                  disabled={busy}
                  paddingHorizontal="$3"
                  paddingVertical="$2"
                  borderRadius="$md"
                  backgroundColor="$primary"
                >
                  <Prim.Text color="$primary-foreground" fontSize="$sm">
                    Accept
                  </Prim.Text>
                </Prim.Pressable>
              </Prim.Row>
            ))}
          </Prim.Col>
        </Prim.Box>
      ) : null}

      <Prim.Box marginBottom="$6">
        <Prim.Text as="h2" fontSize="$sm" fontWeight="600" marginBottom="$2">
          Your teams
        </Prim.Text>
        {loading ? (
          <Prim.Text color="$muted-foreground" fontSize="$sm">
            Loading…
          </Prim.Text>
        ) : teams.length === 0 ? (
          <Prim.Text color="$muted-foreground" fontSize="$sm">
            You are not on a team yet. Create one below.
          </Prim.Text>
        ) : (
          <Prim.Col gap="$2">
            {teams.map((team) => (
              <Prim.Pressable
                key={team.id}
                onClick={() =>
                  void navigate({ to: '/team/$teamId', params: { teamId: team.id } })
                }
                padding="$3"
                borderWidth={1}
                borderColor="$border"
                borderRadius="$md"
                hoverStyle={{ backgroundColor: '$accent' }}
              >
                <Prim.Text fontWeight="500">{team.name}</Prim.Text>
                <Prim.Text fontSize="$xs" color="$muted-foreground">
                  {team.role}
                </Prim.Text>
              </Prim.Pressable>
            ))}
          </Prim.Col>
        )}
      </Prim.Box>

      <Prim.Box>
        <Prim.Text as="h2" fontSize="$sm" fontWeight="600" marginBottom="$2">
          New team
        </Prim.Text>
        <Prim.Row gap="$2">
          <Prim.TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name"
            flex={1}
          />
          <Prim.Pressable
            onClick={() => void create()}
            disabled={busy || !name.trim()}
            paddingHorizontal="$4"
            paddingVertical="$2"
            borderRadius="$md"
            backgroundColor="$primary"
            opacity={busy || !name.trim() ? 0.5 : 1}
          >
            <Prim.Text color="$primary-foreground" fontSize="$sm">
              Create
            </Prim.Text>
          </Prim.Pressable>
        </Prim.Row>
      </Prim.Box>
    </Prim.Box>
  )
}

export const Route = createFileRoute('/team/')({
  component: TeamsIndex,
})

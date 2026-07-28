import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { Page, PageBody } from '@lmthing/ui/elements/layouts/page'
import { Card } from '@lmthing/ui/elements/content/card'
import { ListItem } from '@lmthing/ui/elements/content/list-item'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Avatar, AvatarFallback } from '@lmthing/ui/elements/content/avatar'
import { Mail, Plus, Users } from 'lucide-react'
import { initials } from '@lmthing/ui/team'
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
      // Defaulted, not trusted: this screen renders `invites.length` and `teams.length` directly,
      // so ONE absent key in the payload replaced the whole page with "Something went wrong!
      // Cannot read properties of undefined". An empty list is a screen a member can still use.
      setTeams(data.teams ?? [])
      setInvites(data.invites ?? [])
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
    <Page>
      <PageBody>
      <Prim.Box maxWidth={720} marginHorizontal="auto" width="100%">
        <Heading level={1}>Teams</Heading>
        <Caption marginBottom="$6">
          A shared workspace with its own runtime, subscription and credentials.
        </Caption>

        {error ? (
          <Caption color="$destructive" marginBottom="$4">
            {error}
          </Caption>
        ) : null}

        {invites.length > 0 ? (
          <Prim.Box marginBottom="$6">
            <Heading level={4} marginBottom="$2">
              Invitations
            </Heading>
            <Card>
              {invites.map((invite, i) => (
                <Prim.Box key={invite.id}>
                  <ListItem
                    paddingHorizontal="$4"
                    paddingVertical="$3"
                    cursor="default"
                    hoverStyle={{ backgroundColor: 'transparent' }}
                  >
                    <Avatar size="sm">
                      <AvatarFallback colorKey={invite.team_id}>
                        <Mail size={14} aria-hidden={true} />
                      </AvatarFallback>
                    </Avatar>
                    <Prim.Box flex={1} minWidth={0} marginLeft="$3">
                      <Prim.Text fontSize="$sm" fontWeight="$medium">
                        {invite.team_name}
                      </Prim.Text>
                      <Badge variant="muted">{invite.role}</Badge>
                    </Prim.Box>
                    <Button
                      size="sm"
                      onClick={() => void accept(invite)}
                      disabled={busy}
                    >
                      Accept
                    </Button>
                  </ListItem>
                  {i < invites.length - 1 ? (
                    <Prim.Box height={1} backgroundColor="$border" />
                  ) : null}
                </Prim.Box>
              ))}
            </Card>
          </Prim.Box>
        ) : null}

        <Prim.Box marginBottom="$6">
          <Heading level={4} marginBottom="$2">
            Your teams
          </Heading>
          {loading ? (
            <Caption>Loading…</Caption>
          ) : teams.length === 0 ? (
            <Card padding="$6" display="flex" flexDirection="column" alignItems="center">
              <Prim.Box
                backgroundColor="$muted"
                borderRadius="$radius-full"
                width="$10"
                height="$10"
                display="flex"
                alignItems="center"
                justifyContent="center"
                marginBottom="$3"
              >
                <Users size={20} color="var(--muted-foreground)" aria-hidden={true} />
              </Prim.Box>
              <Caption>You are not on a team yet. Create one below.</Caption>
            </Card>
          ) : (
            <Card>
              {teams.map((team, i) => (
                <Prim.Box key={team.id}>
                  <ListItem
                    paddingHorizontal="$4"
                    paddingVertical="$3"
                    onClick={() =>
                      void navigate({ to: '/team/$teamId', params: { teamId: team.id } })
                    }
                  >
                    <Avatar size="sm">
                      <AvatarFallback colorKey={team.id}>{initials(team.name)}</AvatarFallback>
                    </Avatar>
                    <Prim.Box flex={1} minWidth={0} marginLeft="$3">
                      <Prim.Text fontSize="$sm" fontWeight="$medium">
                        {team.name}
                      </Prim.Text>
                    </Prim.Box>
                    <Badge variant={team.role === 'editor' ? 'primary' : 'muted'}>
                      {team.role}
                    </Badge>
                  </ListItem>
                  {i < teams.length - 1 ? (
                    <Prim.Box height={1} backgroundColor="$border" />
                  ) : null}
                </Prim.Box>
              ))}
            </Card>
          )}
        </Prim.Box>

        <Prim.Box>
          <Heading level={4} marginBottom="$2">
            New team
          </Heading>
          <Prim.Row gap="$2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Team name"
              flex={1}
            />
            <Button onClick={() => void create()} disabled={busy || !name.trim()}>
              <Plus size={14} aria-hidden={true} />
              Create
            </Button>
          </Prim.Row>
        </Prim.Box>
      </Prim.Box>
      </PageBody>
    </Page>
  )
}

export const Route = createFileRoute('/team/')({
  component: TeamsIndex,
})

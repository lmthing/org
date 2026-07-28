import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { TeamChannelsView, createTeamClient, type Rail } from '@lmthing/ui/team'
import { useAuth } from '@lmthing/auth'
import { listTeams, teamAppUrl, teamTokenGetter, TEAM_BASE_URL, type TeamSummary } from './team'
import { registerForPush } from './push'

/**
 * The team surface on a phone.
 *
 * The screen itself is `@lmthing/ui/team`'s — the SAME component `apps/web`
 * renders. This file is the host, and supplies only what is genuinely native:
 * the pod reached at an absolute URL, and "which channel / what is the rail
 * showing" held in component state rather than a URL, because there is no URL.
 *
 * That is the whole divergence budget for this screen. Anything else that ended
 * up here would be a fork of the product wearing a file path — see this app's
 * `scripts/lint-barrel-imports.mjs`.
 */
export function TeamScreen({ onMentionCount }: { onMentionCount?: (count: number) => void }) {
  const { getAccessToken } = useAuth()
  const [teams, setTeams] = React.useState<TeamSummary[] | null>(null)
  const [teamId, setTeamId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // The rail and the active channel: URL state on web, component state here.
  const [activeChannelId, setActiveChannelId] = React.useState<string | null>(null)
  const [rail, setRail] = React.useState<Rail>(null)

  React.useEffect(() => {
    void (async () => {
      try {
        const list = await listTeams(getAccessToken)
        setTeams(list)
        setTeamId((current) => current ?? list[0]?.id ?? null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [getAccessToken])

  // Registering the device is not gated on opening a team: a member should be
  // notified about a DM whether or not they happened to open the app on the team
  // it arrived in.
  React.useEffect(() => {
    void registerForPush(getAccessToken)
  }, [getAccessToken])

  const client = React.useMemo(
    () =>
      teamId
        ? createTeamClient({
            // Absolute, unlike web: native has no origin to be same-origin with.
            baseUrl: TEAM_BASE_URL,
            getToken: teamTokenGetter(teamId, getAccessToken),
          })
        : null,
    [teamId, getAccessToken],
  )

  const team = teams?.find((t) => t.id === teamId)

  if (error) return <Centered>{error}</Centered>
  if (!teams) return <Centered>Loading your teams…</Centered>
  if (!teams.length) return <Centered>You are not on a team yet.</Centered>
  if (!client || !team) return <Centered>Opening the team…</Centered>

  return (
    <TeamChannelsView
      client={client}
      isEditor={team.role === 'editor'}
      activeChannelId={activeChannelId}
      rail={rail}
      onSelectChannel={(channelId) => {
        setActiveChannelId(channelId)
        // A thread belongs to the channel it is in, and a pinned app to the
        // channel you just left — same rule as web, made by the same component.
        setRail(null)
      }}
      onOpenThread={(threadId) => setRail({ kind: 'thread', threadId })}
      onOpenApp={(projectId) => setRail({ kind: 'app', projectId })}
      onCloseRail={() => setRail(null)}
      appUrl={teamAppUrl}
      // The tab is mounted-but-hidden while somebody is on Home or Chat, so it is still receiving
      // the channel socket's events — which makes it the only thing that can say a mention arrived
      // while the member was somewhere else. Web spends the same number on the tab title.
      {...(onMentionCount ? { onMentionCount } : {})}
      // This screen already knows both of these and used to keep them to itself: it opened
      // `teams[0]` without ever saying which team that was, and a member on two teams had no way
      // to reach the second one.
      team={{ id: team.id, name: team.name }}
      teams={teams.map((t) => ({ id: t.id, name: t.name }))}
      onSwitchTeam={(id) => {
        setTeamId(id)
        setActiveChannelId(null)
        setRail(null)
      }}
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Prim.Box display="flex" flex={1} alignItems="center" justifyContent="center" padding="$4">
      <Prim.Text textAlign="center">{children}</Prim.Text>
    </Prim.Box>
  )
}

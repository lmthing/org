import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import { TeamChannelsView, createTeamClient, type Rail } from '@lmthing/ui/team'
import { useAuth } from '@lmthing/auth'
import { listTeams, teamAppUrl, teamTokenGetter, TEAM_BASE_URL, type TeamSummary } from './team'
import { registerForPush } from './push'
import { AppScreen } from './AppScreen'
import { fetchAppTarget, type AppTarget } from './app-views'

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

  // Opening a pinned app is now a question before it is a state change: a
  // `system-viewbuilder` app renders NATIVELY and must never reach a WebView, and the
  // only way to know which kind it is, is to ask the pod for its specs. So the probe
  // runs first and its answer picks the destination — the native screen, or the rail
  // exactly as before. `probing` holds the project while that round trip is in flight.
  const [probing, setProbing] = React.useState<string | null>(null)
  const [nativeApp, setNativeApp] = React.useState<{ id: string; target: AppTarget } | null>(null)

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

  // One getter per team, shared by the channel client and by anything else that has to
  // reach this team's pod — the getter caches the minted token in memory, so making a
  // second one would mint a second credential for the same team.
  const getTeamToken = React.useMemo(
    () => (teamId ? teamTokenGetter(teamId, getAccessToken) : null),
    [teamId, getAccessToken],
  )

  const client = React.useMemo(
    () =>
      getTeamToken
        ? createTeamClient({
            // Absolute, unlike web: native has no origin to be same-origin with.
            baseUrl: TEAM_BASE_URL,
            getToken: getTeamToken,
          })
        : null,
    [getTeamToken],
  )

  React.useEffect(() => {
    if (!probing || !getTeamToken) return
    let cancelled = false
    const projectId = probing
    void fetchAppTarget(TEAM_BASE_URL, getTeamToken, projectId).then((target) => {
      if (cancelled) return
      // Native apps take the whole screen; the WebView kind keeps the rail it has always
      // had, byte for byte. On a phone the rail is full-width anyway, so what actually
      // differs is the back affordance, and each screen brings its own.
      if (target.kind === 'native') setNativeApp({ id: projectId, target })
      else setRail({ kind: 'app', projectId })
      setProbing(null)
    })
    return () => {
      cancelled = true
    }
  }, [probing, getTeamToken])

  // Switching teams cannot leave another team's app on screen.
  React.useEffect(() => {
    setNativeApp(null)
    setProbing(null)
  }, [teamId])

  const team = teams?.find((t) => t.id === teamId)

  if (error) return <Centered>{error}</Centered>
  if (!teams) return <Centered>Loading your teams…</Centered>
  if (!teams.length) return <Centered>You are not on a team yet.</Centered>
  if (!client || !team) return <Centered>Opening the team…</Centered>

  // A spec app covers the surface rather than sitting in the rail — it IS a set of screens,
  // not a page to glance at. Closing it puts the member back exactly where they were, because
  // the channels view underneath was never unmounted, only covered.
  if (nativeApp && getTeamToken) {
    return (
      <AppScreen
        projectId={nativeApp.id}
        name={nativeApp.id}
        onClose={() => setNativeApp(null)}
        baseUrl={TEAM_BASE_URL}
        getToken={getTeamToken}
        appUrl={teamAppUrl}
        target={nativeApp.target}
      />
    )
  }

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
      // Not a state change yet — the probe decides whether this app belongs on the rail
      // or on the native screen. See `probing` above.
      onOpenApp={(projectId) => setProbing(projectId)}
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

import * as React from 'react'
import { ActivityIndicator, AppState, Linking } from 'react-native'
import * as Prim from '@lmthing/ui/elements/primitives'
import { TeamChannelsView, createTeamClient, type Rail } from '@lmthing/ui/team'
import { useAuth } from '@lmthing/auth'
import { listTeams, teamAppUrl, teamTokenGetter, TEAM_BASE_URL, type TeamSummary } from './team'
import { registerForPush } from './push'
import { AppScreen } from './AppScreen'
import { fetchAppTarget, type AppTarget } from './app-views'
import { resolveFocusTeamId } from './team-focus'
import { hapticWarning, hapticLight } from './haptics'

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
export function TeamScreen({
  onMentionCount,
  openTeamId,
  openChannelId,
}: {
  onMentionCount?: (count: number) => void
  /**
   * Focus this team — a tap on a TEAMS row or an invitation on the Home dashboard, or a push
   * notification's deep link. A request that names a team the member is not actually on is
   * ignored rather than honoured; see `./team-focus.ts#resolveFocusTeamId`.
   */
  openTeamId?: string | null
  /** Also select this channel once its team is open — set together with `openTeamId`. */
  openChannelId?: string | null
}) {
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

  // Pulled out of the mount effect so a failed fetch has something for a Retry button to call —
  // previously there was none, and because this tab is mounted-but-hidden (never unmounted, see
  // `App.tsx#HomeShell`) rather than remounted, switching away and back could not retry it either.
  //
  // `hadErrorRef` fires the ONE haptic warning this failure gets, on the transition INTO the error
  // state rather than on every call — this also runs from the silent `AppState` background refresh
  // below, and a phone with no signal buzzing once a foreground cycle for as long as it stays
  // offline is the "scary banner on every slow request" this pass was explicitly told not to build.
  const hadErrorRef = React.useRef(false)
  const refresh = React.useCallback(async () => {
    try {
      const list = await listTeams(getAccessToken)
      hadErrorRef.current = false
      setError(null)
      setTeams(list)
    } catch (err) {
      if (!hadErrorRef.current) void hapticWarning()
      hadErrorRef.current = true
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [getAccessToken])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // Coming back from the background is the other time this list goes stale — a member could
  // have been added to a team, or removed from one, entirely outside this app. Nothing else here
  // watches `AppState`, and a stale list just sat there until the member happened to remember to
  // pull down (there is no pull-to-refresh either — `TeamChannelsView` owns the actual scrollable
  // list and has no `onRefresh` to give it one; see this fix's report).
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh()
    })
    return () => subscription.remove()
  }, [refresh])

  // Registering the device is not gated on opening a team: a member should be
  // notified about a DM whether or not they happened to open the app on the team
  // it arrived in.
  React.useEffect(() => {
    void registerForPush(getAccessToken)
  }, [getAccessToken])

  // Which team is selected — a request to focus one (never a team the member is not actually on,
  // so a stale invite id or a push notification for a team since left does not silently swap the
  // screen onto some OTHER team) FIRST, falling back to the first remaining team when the current
  // selection no longer exists (a refresh can drop it — membership revoked, the team deleted —
  // and without this fallback that read as a permanent "Opening the team…" spinner rather than
  // landing somewhere real). One effect, not two, so the two rules cannot race each other's
  // `setTeamId` in the same commit.
  React.useEffect(() => {
    if (!teams?.length) return
    setTeamId((current) => {
      const focused = resolveFocusTeamId(teams, openTeamId, current)
      return focused && teams.some((t) => t.id === focused) ? focused : teams[0]!.id
    })
  }, [openTeamId, teams])

  // A channel named alongside it — e.g. `team-push.ts`'s deep link. Applied independently of
  // whether the team switch above landed on this render or a later one; `TeamChannelsView`
  // simply shows nothing selected if the id turns out not to exist, same as any other unknown id.
  React.useEffect(() => {
    if (!openChannelId) return
    setActiveChannelId(openChannelId)
    setRail(null)
  }, [openChannelId])

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

  // Each of these used to be a bare sentence and a dead end: no spinner, no retry, and (since
  // this tab is hidden rather than unmounted, see `refresh` above) no way to make a failed fetch
  // try again short of force-quitting the app.
  if (error) {
    return (
      <Centered>
        <Prim.Text textAlign="center" color="$destructive">
          {error}
        </Prim.Text>
        <RetryButton onPress={() => void refresh()} />
      </Centered>
    )
  }
  if (!teams) {
    return (
      <Centered>
        <ActivityIndicator />
        <Prim.Text textAlign="center" marginTop="$3">
          Loading your teams…
        </Prim.Text>
      </Centered>
    )
  }
  if (!teams.length) {
    return (
      <Centered>
        <Prim.Text textAlign="center">You are not on a team yet.</Prim.Text>
        <Prim.Text textAlign="center" fontSize="$sm" color="$muted-foreground" marginTop="$1">
          An invitation lands here once someone adds you — pull down, or open lmthing.team to
          create or join one.
        </Prim.Text>
        <RetryButton onPress={() => void refresh()} />
        <Prim.Pressable
          onClick={() => void Linking.openURL(TEAM_BASE_URL)}
          minHeight="$12"
          paddingHorizontal="$4"
          display="flex"
          alignItems="center"
          justifyContent="center"
          marginTop="$2"
          aria-label="Open lmthing.team"
        >
          <Prim.Text color="$primary" fontWeight="$semibold">
            Open lmthing.team
          </Prim.Text>
        </Prim.Pressable>
      </Centered>
    )
  }
  if (!client || !team) {
    return (
      <Centered>
        <ActivityIndicator />
        <Prim.Text textAlign="center" marginTop="$3">
          Opening the team…
        </Prim.Text>
      </Centered>
    )
  }

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
      // or on the native screen. See `probing` above. There is no spinner for `probing` itself
      // (adding one means restructuring `TeamChannelsView`'s own scroll container, a `libs/ui`
      // change — see this fix's report), so the tap otherwise looks like it did nothing at all
      // until the round trip resolves; the light haptic is the one thing this host CAN give
      // immediately, on every target, with no risk to that surface's layout.
      onOpenApp={(projectId) => {
        void hapticLight()
        setProbing(projectId)
      }}
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

/**
 * A centered status screen: a spinner or a message, and now optionally something to press.
 * Column, not the `display: 'flex'` default a bare `Prim.Box` reads as ROW on native (see
 * `App.tsx#HomeShell`'s note on the same trap) — a spinner beside its caption instead of above it
 * was the first symptom of getting this wrong. Every child is a real element (`Prim.Text`,
 * `ActivityIndicator`, a `Pressable`), never a bare string — those are silently dropped inside a
 * View on this target.
 */
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Prim.Col flex={1} alignItems="center" justifyContent="center" padding="$4" gap="$2">
      {children}
    </Prim.Col>
  )
}

/** A tap target that reaches the platform minimum (Apple 44pt / Android 48dp) either way. */
function RetryButton({ onPress }: { onPress: () => void }) {
  return (
    <Prim.Pressable
      onClick={onPress}
      minHeight="$12"
      paddingHorizontal="$4"
      display="flex"
      alignItems="center"
      justifyContent="center"
      marginTop="$2"
      aria-label="Retry"
    >
      <Prim.Text color="$primary" fontWeight="$semibold">
        Retry
      </Prim.Text>
    </Prim.Pressable>
  )
}

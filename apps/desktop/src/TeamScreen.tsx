import * as React from 'react'
import * as Prim from '@lmthing/ui/elements/primitives'
import {
  TeamChannelsView,
  createTeamClient,
  listTeams,
  teamAppUrl,
  teamTokenGetter,
  resolveFocusTeamId,
  type Rail,
  type TeamSummary,
} from '@lmthing/ui/team'
import { useAuth } from '@lmthing/auth'
import { teamBase } from '@lmthing/ui/platform'
import { openUrl } from '@tauri-apps/plugin-opener'

/**
 * The team surface in a desktop window.
 *
 * The screen itself is `@lmthing/ui/team`'s — the SAME component `apps/web` and `apps/mobile`
 * render. This file is only the host, and supplies the three things that genuinely differ: how the
 * pod is reached, where "which channel / what is the rail showing" lives, and where project pages
 * are served. That is the declared divergence budget for this screen
 * (`libs/ui/src/team/index.ts`); anything else appearing here would be a fork of the product
 * wearing a file path, which `scripts/lint-barrel-imports.mjs` exists to make hard to do by accident.
 *
 * Channel/rail state is held in component state rather than a URL, matching mobile: the desktop
 * shell has no router, because its panes are a window's state and not a browser history.
 *
 * Unlike mobile there is no app-target probe. A pinned app opens on the rail, exactly as it does on
 * web — the probe exists on the phone to keep a `system-appbuilder` app out of a WebView, and a
 * desktop window is wide enough for the rail the web surface was designed around.
 */
export function TeamScreen({
  onMentionCount,
  openTeamId,
  openChannelId,
  onSwitchSurface,
}: {
  onMentionCount?: (count: number) => void
  /**
   * Focus this team — a click on a TEAMS row or an invitation on the Home dashboard. A request
   * naming a team the member is not actually on is ignored rather than honoured; see
   * `@lmthing/ui/team#resolveFocusTeamId`.
   */
  openTeamId?: string | null
  /** Also select this channel once its team is open — set together with `openTeamId`. */
  openChannelId?: string | null
  onSwitchSurface?: (surface: 'home' | 'chat' | 'teams') => void
}) {
  const { getAccessToken } = useAuth()
  const [teams, setTeams] = React.useState<TeamSummary[] | null>(null)
  const [teamId, setTeamId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const [activeChannelId, setActiveChannelId] = React.useState<string | null>(null)
  const [rail, setRail] = React.useState<Rail>(null)

  // Pulled out of the mount effect so a failed fetch has something for Retry to call. This pane is
  // mounted-but-hidden rather than unmounted (see `HomeShell`), so switching away and back cannot
  // retry it either — without this there is no way back short of quitting.
  const refresh = React.useCallback(async () => {
    try {
      const list = await listTeams(getAccessToken)
      setError(null)
      setTeams(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [getAccessToken])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  // Returning to the window is when this list goes stale: a member could have been added to a team,
  // or removed from one, entirely outside this app. `visibilitychange` is the web equivalent of the
  // `AppState` listener the phone uses for the same reason.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  // Which team is selected: a focus request first (never a team the member is not on, so a stale
  // invite id cannot silently swap the window onto some OTHER team), falling back to the first
  // remaining team when the current selection no longer exists — a refresh can drop it, and without
  // the fallback that reads as a permanent "Opening the team…" rather than landing somewhere real.
  // One effect, not two, so the rules cannot race each other's `setTeamId` in one commit.
  React.useEffect(() => {
    if (!teams?.length) return
    setTeamId((current) => {
      const focused = resolveFocusTeamId(teams, openTeamId, current)
      return focused && teams.some((t) => t.id === focused) ? focused : teams[0]!.id
    })
  }, [openTeamId, teams])

  React.useEffect(() => {
    if (!openChannelId) return
    setActiveChannelId(openChannelId)
    setRail(null)
  }, [openChannelId])

  // One getter per team, shared by the channel client and anything else reaching this team's pod:
  // the getter caches the minted token in memory, so a second one would mint a second credential.
  const getTeamToken = React.useMemo(
    () => (teamId ? teamTokenGetter(teamId, getAccessToken) : null),
    [teamId, getAccessToken],
  )

  const client = React.useMemo(
    () =>
      getTeamToken ? createTeamClient({ baseUrl: teamBase(), getToken: getTeamToken }) : null,
    [getTeamToken],
  )

  const team = teams?.find((t) => t.id === teamId)

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
        <Prim.Text textAlign="center">Loading your teams…</Prim.Text>
      </Centered>
    )
  }
  if (!teams.length) {
    return (
      <Centered>
        <Prim.Text textAlign="center">You are not on a team yet.</Prim.Text>
        <Prim.Text textAlign="center" fontSize="$sm" color="$muted-foreground" marginTop="$1">
          An invitation lands here once someone adds you — or open lmthing.team to create or join one.
        </Prim.Text>
        <RetryButton onPress={() => void refresh()} />
        {/* The SYSTEM browser, not this window. Navigating the single webview to lmthing.team
            would replace the app with a website and leave no way back. */}
        <Prim.Pressable
          onClick={() => void openUrl(teamBase())}
          minHeight="$10"
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
        <Prim.Text textAlign="center">Opening the team…</Prim.Text>
      </Centered>
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
        // A thread belongs to the channel it is in, and a pinned app to the channel you just left —
        // the same rule as web and mobile, made by the same component.
        setRail(null)
      }}
      onOpenThread={(threadId) => setRail({ kind: 'thread', threadId })}
      onOpenApp={(projectId) => setRail({ kind: 'app', projectId })}
      onCloseRail={() => setRail(null)}
      appUrl={teamAppUrl}
      // This pane stays mounted while somebody is on Home or Chat, so it keeps hearing the channel
      // socket — which makes it the only thing that can report a mention that arrived while they
      // were elsewhere.
      {...(onMentionCount ? { onMentionCount } : {})}
      team={{ id: team.id, name: team.name }}
      teams={teams.map((t) => ({ id: t.id, name: t.name }))}
      onSwitchTeam={(id) => {
        setTeamId(id)
        setActiveChannelId(null)
        setRail(null)
      }}
      onSwitchSurface={onSwitchSurface}
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Prim.Col flex={1} alignItems="center" justifyContent="center" padding="$4" gap="$2">
      {children}
    </Prim.Col>
  )
}

function RetryButton({ onPress }: { onPress: () => void }) {
  return (
    <Prim.Pressable
      onClick={onPress}
      minHeight="$10"
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

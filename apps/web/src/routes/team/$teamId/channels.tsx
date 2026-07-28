import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TeamChannelsView, createTeamClient, type Rail } from '@lmthing/ui/team'
import { useAuth } from '@lmthing/auth'
import { APP_PATH_PREFIX, COMPUTER_BASE_URL } from '@/lib/config'
import { useTeamAuth } from '@/lib/team-auth'
import { teamApi, type TeamSummary } from '@/lib/team-api'

/**
 * The web host for the shared team surface.
 *
 * The surface itself lives in `@lmthing/ui/team` and is rendered identically by
 * `apps/mobile`. This file supplies only what is genuinely web: the URL as the
 * home of "which channel, and what is the rail showing", the pod reached
 * same-origin, and the document title.
 *
 * Keeping the channel and the rail in the URL is the whole reason this is not
 * component state — a member pastes a link to a thread, or to an app beside a
 * channel, and the other end lands on the same view.
 */
function ChannelsPage() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const team = useTeamAuth()
  const navigate = useNavigate()
  const search = useSearch({ from: '/team/$teamId/channels' })

  // Same-origin in production: Envoy routes lmthing.team to the team's pod by the
  // claim in the token this surface holds, so the pod IS this origin — which is
  // exactly what `COMPUTER_BASE_URL` resolves to there, and what `AppProvider` is
  // already pointed at one layer up. Going through the constant rather than a
  // literal `''` keeps the two from ever disagreeing, and lets a local rig point
  // the surface at a team pod on another port (`VITE_COMPUTER_BASE_URL`).
  const client = useMemo(
    () => createTeamClient({ baseUrl: COMPUTER_BASE_URL, getToken: team.getTeamToken }),
    [team],
  )

  // Which teams this member is on — the sidebar names the current one and offers the others. The
  // gateway is asked once per mount; the list is small, changes rarely, and a failure here costs
  // the header, not the surface.
  const { authFetch } = useAuth()
  const [teams, setTeams] = useState<TeamSummary[]>([])
  useEffect(() => {
    let cancelled = false
    void teamApi
      .list(authFetch)
      .then((data) => {
        if (!cancelled) setTeams(data.teams ?? [])
      })
      .catch(() => {
        /* the sidebar simply does not name the team */
      })
    return () => {
      cancelled = true
    }
  }, [authFetch])

  const setSearch = useCallback(
    (next: { channel?: string; thread?: string; app?: string }) => {
      void navigate({ to: '/team/$teamId/channels', params: { teamId }, search: next, replace: true })
    },
    [navigate, teamId],
  )

  const activeChannelId = search.channel ?? null
  const rail: Rail = search.thread
    ? { kind: 'thread', threadId: search.thread }
    : search.app
      ? { kind: 'app', projectId: search.app }
      : null

  const withChannel = (extra: { thread?: string; app?: string } = {}) => ({
    ...(activeChannelId ? { channel: activeChannelId } : {}),
    ...extra,
  })

  const current = teams.find((t) => t.id === teamId)

  const setTitle = useCallback((count: number) => {
    document.title = count > 0 ? `(${count}) lmthing` : 'lmthing'
  }, [])
  useEffect(() => () => void (document.title = 'lmthing'), [])

  return (
    <TeamChannelsView
      client={client}
      isEditor={team.role === 'editor'}
      activeChannelId={activeChannelId}
      rail={rail}
      // A thread belongs to the channel it is in, so switching channels closes
      // it — and a pinned app does not survive the move either.
      onSelectChannel={(channelId) => setSearch({ channel: channelId })}
      onOpenThread={(threadId) => setSearch(withChannel({ thread: threadId }))}
      onOpenApp={(projectId) => setSearch(withChannel({ app: projectId }))}
      onCloseRail={() => setSearch(withChannel())}
      // The pod serves the app's pages, and on lmthing.team that is this origin —
      // so in production this is the same string as the bare path it replaces. It
      // goes through the constant for the same reason the client does: a rig that
      // puts the team pod on another port must reach the app there and not here,
      // where the SPA's catch-all would answer with itself inside the frame.
      appUrl={(projectId) => `${COMPUTER_BASE_URL}${APP_PATH_PREFIX}/${projectId}/`}
      onMentionCount={setTitle}
      {...(current ? { team: { id: current.id, name: current.name } } : {})}
      teams={teams.map((t) => ({ id: t.id, name: t.name }))}
      onSwitchTeam={(id) => void navigate({ to: '/team/$teamId/channels', params: { teamId: id } })}
    />
  )
}

export const Route = createFileRoute('/team/$teamId/channels')({
  /**
   * The channel on screen and what the rail is showing are URL state, not
   * component state: a member pastes a link to "this thread" or "this app beside
   * this channel" and the other end lands on the same view.
   */
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search['channel'] === 'string' ? { channel: search['channel'] } : {}),
    ...(typeof search['thread'] === 'string' ? { thread: search['thread'] } : {}),
    ...(typeof search['app'] === 'string' ? { app: search['app'] } : {}),
  }),
  component: ChannelsPage,
})

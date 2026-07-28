import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo } from 'react'
import { TeamChannelsView, createTeamClient, type Rail } from '@lmthing/ui/team'
import { APP_PATH_PREFIX } from '@/lib/config'
import { useTeamAuth } from '@/lib/team-auth'

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

  // Same-origin: Envoy routes lmthing.team to the team's pod by the claim in the
  // token this surface holds, so the pod IS this origin and a relative path is
  // correct. (Native passes an absolute base instead.)
  const client = useMemo(
    () => createTeamClient({ baseUrl: '', getToken: team.getTeamToken }),
    [team],
  )

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
      appUrl={(projectId) => `${APP_PATH_PREFIX}/${projectId}/`}
      onMentionCount={setTitle}
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

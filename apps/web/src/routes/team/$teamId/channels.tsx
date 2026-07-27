import * as Prim from '@lmthing/ui/elements/primitives'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { createFileRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, MessageSquare, X } from 'lucide-react'
import { useTeamAuth } from '@/lib/team-auth'
import { dmPartner, memberLabel, type ChannelMessage } from '@/lib/team-pod'
import { useTeamChat } from '@/components/team/use-team-chat'
import { ChannelSidebar } from '@/components/team/sidebar'
import { Composer } from '@/components/team/composer'
import {
  AppFrame,
  ChannelHeader,
  OpenAppExternally,
  RailPane,
  type Rail,
} from '@/components/team/rail'
import {
  MessageGroupView,
  MessageRow,
  ThreadSummary,
  TypingStrip,
  groupMessages,
  showsHeader,
  type MessageContext,
} from '@/components/team/messages'

/**
 * The team's chat: channels down the side, the conversation in the middle, and
 * a rail on the right holding either a thread or an app.
 *
 * Members talk to each other here and call THING with an `@thing` mention; it
 * answers in the thread and remembers the conversation across messages. When a
 * turn produces an app, the app is pinned to the channel and opens beside it —
 * asking for something and receiving it in the same place is the whole idea.
 *
 * All of this talks to the TEAM's pod at the same origin — Envoy routes
 * lmthing.team by the team claim in the token this surface holds.
 */
function ChannelsPage() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const team = useTeamAuth()
  const navigate = useNavigate()
  const search = useSearch({ from: '/team/$teamId/channels' })
  const [fallbackId, setFallbackId] = useState<string | null>(null)
  const activeId = search.channel ?? fallbackId
  const chat = useTeamChat(team, activeId)
  const meId = chat.meId
  const transcriptRef = useRef<HTMLDivElement>(null)

  const isEditor = team.role === 'editor'

  // The channel and the rail live in the URL, so "here, look at this" pastes
  // into the same view rather than the other person's default one.
  const setSearch = useCallback(
    (next: { channel?: string; thread?: string; app?: string }) => {
      void navigate({
        to: '/team/$teamId/channels',
        params: { teamId },
        search: next,
        replace: true,
      })
    },
    [navigate, teamId],
  )

  // Land on a channel when the URL names none — the first named one, since a
  // direct message is a poor thing to open somebody into by default.
  useEffect(() => {
    if (search.channel || fallbackId || !chat.channels.length) return
    setFallbackId(chat.channels.find((c) => c.kind !== 'dm')?.id ?? chat.channels[0]!.id)
  }, [search.channel, fallbackId, chat.channels])

  const rail: Rail = search.thread
    ? { kind: 'thread', threadId: search.thread }
    : search.app
      ? { kind: 'app', projectId: search.app }
      : null

  // A thread belongs to the channel it is in, so switching channels closes it.
  // A pinned app does not survive the move either — it is pinned to the channel
  // you just left.
  const selectChannel = (channelId: string) => setSearch({ channel: channelId })
  const openThread = (threadId: string) =>
    setSearch({ ...(activeId ? { channel: activeId } : {}), thread: threadId })
  const openApp = useCallback(
    (projectId: string) => setSearch({ ...(activeId ? { channel: activeId } : {}), app: projectId }),
    [setSearch, activeId],
  )
  const closeRail = () => setSearch({ ...(activeId ? { channel: activeId } : {}) })

  const channel = useMemo(
    () => chat.channels.find((c) => c.id === activeId),
    [chat.channels, activeId],
  )

  const ctx: MessageContext = useMemo(
    () => ({
      members: chat.directory.members,
      appProjects: new Set(chat.directory.projects.filter((p) => p.hasApp).map((p) => p.id)),
      onOpenApp: openApp,
    }),
    [chat.directory, openApp],
  )

  // An app THING just built opens beside the person who ASKED for it. Everyone
  // else gets the tab in the header and the card in the thread — an offer, not a
  // pane thrown open over work they were in the middle of.
  const lastMessageId = chat.messages[chat.messages.length - 1]?.id
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1]
    if (!last?.app) return
    // The card is threaded under the message that asked for it, so the root of
    // its thread is who asked.
    const ask = chat.messages.find((m) => m.id === last.threadId)
    if (ask?.userId === meId) openApp(last.app.projectId)
    // Keyed on the last message's id ALONE, deliberately: this must fire on the
    // ARRIVAL of a card, not on every re-render that happens to have one at the
    // end — which is what depending on `chat.messages` would do, reopening a
    // pane the member had just closed.
  }, [lastMessageId])

  // Follow the conversation, the way a chat surface is expected to.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages.length, activeId])

  const roots = useMemo(() => chat.messages.filter((m) => !m.threadId), [chat.messages])
  const repliesOf = useCallback(
    (rootId: string) => chat.messages.filter((m) => m.threadId === rootId),
    [chat.messages],
  )

  const title = channelTitle(channel, chat.directory.members, meId)

  return (
    <Prim.Row height="100%" minWidth={0}>
      <ChannelSidebar
        channels={chat.channels}
        categories={chat.categories}
        members={chat.directory.members}
        meId={meId}
        activeId={activeId}
        isEditor={isEditor}
        onSelect={selectChannel}
        onCreateChannel={(name, categoryId) => void chat.createChannel(name, categoryId)}
        onCreateCategory={(name) => void chat.createCategory(name)}
        onDeleteCategory={(id) => void chat.deleteCategory(id)}
        onMoveChannel={(channelId, categoryId) => void chat.patchChannel(channelId, { categoryId })}
        onOpenDm={(userId) => {
          void chat.openDm(userId).then((channel) => channel && selectChannel(channel.id))
        }}
      />

      <Prim.Col flex={1} minWidth={0} height="100%">
        <ChannelHeader
          channel={channel}
          title={title}
          {...(channel?.kind === 'dm' ? { subtitle: 'Direct message' } : {})}
          projects={chat.directory.projects}
          rail={rail}
          isEditor={isEditor}
          onOpenApp={openApp}
          onAttachApp={(projectId) => {
            void chat.patchChannel(activeId!, { apps: [...(channel?.apps ?? []), projectId] })
            openApp(projectId)
          }}
          onDetachApp={(projectId) => {
            void chat.patchChannel(activeId!, {
              apps: (channel?.apps ?? []).filter((id) => id !== projectId),
            })
            if (rail?.kind === 'app' && rail.projectId === projectId) closeRail()
          }}
        />

        {chat.error ? (
          <Prim.Row
            alignItems="center"
            gap="$2"
            paddingHorizontal="$4"
            paddingVertical="$2"
            backgroundColor="color-mix(in srgb, var(--destructive) 12%, transparent)"
          >
            <Prim.Text color="$destructive" fontSize="$xs" flex={1} minWidth={0}>
              {chat.error}
            </Prim.Text>
            <Button size="icon" variant="ghost" onClick={chat.dismissError} aria-label="Dismiss">
              <X size={12} aria-hidden={true} />
            </Button>
          </Prim.Row>
        ) : null}

        <Prim.Col ref={transcriptRef} flex={1} minHeight={0} overflow="auto" padding="$4" gap="$4">
          {roots.length === 0 ? (
            <Prim.Col alignItems="center" justifyContent="center" flex={1} gap="$1">
              <Prim.Text fontSize="$sm" color="$muted-foreground">
                {channel?.kind === 'dm'
                  ? `This is the start of your conversation with ${title}.`
                  : `This is the start of #${title}.`}
              </Prim.Text>
              <Caption>Say something — mention @thing to bring THING in.</Caption>
            </Prim.Col>
          ) : null}
          {roots.map((root, i) => {
            const replies = repliesOf(root.id)
            return (
              <Prim.Col key={root.id} gap="$1">
                <MessageRow message={root} showHeader={showsHeader(roots[i - 1], root)} ctx={ctx} />
                <ThreadSummary
                  replies={replies}
                  busy={chat.thinking.has(root.id)}
                  onOpen={() => openThread(root.id)}
                  ctx={ctx}
                />
              </Prim.Col>
            )
          })}
        </Prim.Col>

        {chat.typingHere.length > 0 ? <TypingStrip labels={chat.typingHere} /> : null}

        <Composer
          placeholder={
            channel?.kind === 'dm'
              ? `Message ${title}… (@thing to ask THING)`
              : `Message #${title}… (@thing to ask THING)`
          }
          directory={chat.directory}
          meId={meId}
          disabled={!activeId}
          onTyping={() => activeId && chat.notifyTyping(activeId)}
          onSend={(text) => chat.send(text)}
        />
      </Prim.Col>

      {rail?.kind === 'thread' ? (
        <ThreadRail
          root={chat.messages.find((m) => m.id === rail.threadId)}
          replies={repliesOf(rail.threadId)}
          busy={chat.thinking.has(rail.threadId)}
          directory={chat.directory}
          meId={meId}
          ctx={ctx}
          onClose={closeRail}
          onSend={(text) => chat.send(text, rail.threadId)}
          onTyping={() => activeId && chat.notifyTyping(activeId)}
        />
      ) : null}

      {rail?.kind === 'app' ? (
        <RailPane
          title={
            chat.directory.projects.find((p) => p.id === rail.projectId)?.name ?? rail.projectId
          }
          icon={<AppWindow size={14} aria-hidden={true} />}
          headerExtra={<OpenAppExternally projectId={rail.projectId} />}
          onClose={closeRail}
        >
          <AppFrame
            projectId={rail.projectId}
            name={
              chat.directory.projects.find((p) => p.id === rail.projectId)?.name ?? rail.projectId
            }
          />
        </RailPane>
      ) : null}
    </Prim.Row>
  )
}

/**
 * A thread, in the rail: the message that started it, then every reply, then a
 * composer of its own.
 *
 * This is the Slack shape, and the reason for it is that a thread is a
 * conversation about one message — inlining it under the message meant a busy
 * thread pushed the channel apart and a reader lost the channel's own thread of
 * argument between two long tangents.
 */
function ThreadRail({
  root,
  replies,
  busy,
  directory,
  meId,
  ctx,
  onClose,
  onSend,
  onTyping,
}: {
  root: ChannelMessage | undefined
  replies: ChannelMessage[]
  busy: boolean
  directory: ReturnType<typeof useTeamChat>['directory']
  meId: string
  ctx: MessageContext
  onClose: () => void
  onSend: (text: string) => Promise<void>
  onTyping: () => void
}) {
  const groups = useMemo(() => groupMessages(replies), [replies])
  return (
    <RailPane title="Thread" icon={<MessageSquare size={14} aria-hidden={true} />} onClose={onClose}>
      <Prim.Col flex={1} minHeight={0} overflow="auto" padding="$3" gap="$3">
        {root ? <MessageRow message={root} showHeader={true} ctx={ctx} /> : null}
        <Prim.Row alignItems="center" gap="$2">
          <Prim.Box flex={1} height={1} backgroundColor="$border" />
          <Caption>
            {replies.length === 0
              ? 'No replies yet'
              : replies.length === 1
                ? '1 reply'
                : `${replies.length} replies`}
          </Caption>
          <Prim.Box flex={1} height={1} backgroundColor="$border" />
        </Prim.Row>
        {groups.map((group) => (
          <MessageGroupView key={group.key} group={group} ctx={ctx} />
        ))}
        {busy ? <TypingStrip labels={['THING']} /> : null}
      </Prim.Col>
      <Composer
        placeholder="Reply in thread… (@thing to ask THING)"
        directory={directory}
        meId={meId}
        onTyping={onTyping}
        onSend={onSend}
      />
    </RailPane>
  )
}

/** A named channel is its name; a DM is whoever it is with. */
function channelTitle(
  channel: { kind?: string; name: string; members?: string[] } | undefined,
  members: ReturnType<typeof useTeamChat>['directory']['members'],
  meId: string,
): string {
  if (!channel) return 'Channels'
  if (channel.kind !== 'dm') return channel.name
  const partnerId = dmPartner(channel as never, meId)
  return memberLabel(
    members.find((m) => m.userId === partnerId),
    partnerId ?? 'Direct message',
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

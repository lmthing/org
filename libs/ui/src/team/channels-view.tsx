/**
 * The team's chat surface, whole: channels down the side, the conversation in the
 * middle, and a rail on the right holding either a thread or an app.
 *
 * Prop-driven and router-free ON PURPOSE. Web keeps the channel and the rail in
 * the URL (so "here, look at this" pastes correctly); the mobile app keeps them
 * in component state (it has no URL). Reaching for `@tanstack/react-router` here
 * would have made this file web-only and forked the surface, which is the one
 * thing `apps/mobile` exists to avoid.
 *
 * Members talk to each other here and call THING with an `@thing` mention; it
 * answers in the thread and remembers the conversation across messages. When a
 * turn produces an app, the app is pinned to the channel and opens beside it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Prim from '../elements/primitives/index'
import { Button } from '../elements/forms/button'
import { Caption } from '../elements/typography/caption'
import { AppIcon, CloseIcon, ThreadIcon } from './icons'
import { useTeamChat } from './use-team-chat'
import { useTeamLayout } from './use-layout'
import { ChannelSidebar } from './sidebar'
import { Composer } from './composer'
import { AppFrame, ChannelHeader, OpenAppExternally, RailPane } from './rail'
import {
  MessageGroupView,
  MessageRow,
  ThreadSummary,
  TypingStrip,
  groupMessages,
  showsHeader,
  type MessageContext,
} from './messages'
import { channelTitle } from './format'
import type { ChannelMessage, Directory, Rail } from './types'
import type { TeamClient } from './client'

export interface TeamChannelsViewProps {
  client: TeamClient
  /** Whether this member may configure the team (create channels, pin apps). */
  isEditor: boolean
  /** The channel on screen, and what the rail shows — owned by the HOST. */
  activeChannelId: string | null
  rail: Rail
  onSelectChannel: (channelId: string) => void
  onOpenThread: (threadId: string) => void
  onOpenApp: (projectId: string) => void
  onCloseRail: () => void
  /** Where a project's pages are served, which differs per target. */
  appUrl: (projectId: string) => string
  /** The team on screen. Named in the sidebar, which is the only chrome both targets have. */
  team?: { id: string; name: string }
  /** Every team the member is on, for the sidebar's switcher. */
  teams?: readonly { id: string; name: string }[]
  onSwitchTeam?: (teamId: string) => void
  /** Called with the total mention count whenever it changes (tab badge, app icon badge). */
  onMentionCount?: (count: number) => void
}

export function TeamChannelsView({
  client,
  isEditor,
  activeChannelId,
  rail,
  onSelectChannel,
  onOpenThread,
  onOpenApp,
  onCloseRail,
  appUrl,
  onMentionCount,
  team,
  teams,
  onSwitchTeam,
}: TeamChannelsViewProps) {
  const [fallbackId, setFallbackId] = useState<string | null>(null)
  const activeId = activeChannelId ?? fallbackId
  const chat = useTeamChat(client, activeId)
  const meId = chat.meId
  const { compact } = useTeamLayout()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Text a suggestion elsewhere on the surface wants dropped into the composer, cleared as soon as
  // the composer has taken it.
  const [prefill, setPrefill] = useState<string | null>(null)

  // Land on a channel when the host names none — the first named one, since a
  // direct message is a poor thing to open somebody into by default.
  useEffect(() => {
    if (activeChannelId || fallbackId || !chat.channels.length) return
    setFallbackId(chat.channels.find((c) => c.kind !== 'dm')?.id ?? chat.channels[0]!.id)
  }, [activeChannelId, fallbackId, chat.channels])

  const selectChannel = useCallback(
    (channelId: string) => {
      onSelectChannel(channelId)
      setDrawerOpen(false)
    },
    [onSelectChannel],
  )

  const channel = useMemo(
    () => chat.channels.find((c) => c.id === activeId),
    [chat.channels, activeId],
  )

  const ctx: MessageContext = useMemo(
    () => ({
      members: chat.directory.members,
      appProjects: new Set(chat.directory.projects.filter((p) => p.hasApp).map((p) => p.id)),
      onOpenApp,
    }),
    [chat.directory, onOpenApp],
  )

  // An app THING just built opens beside the person who ASKED for it. Everyone
  // else gets the tab in the header and the card in the thread — an offer, not a
  // pane thrown open over work they were in the middle of.
  const lastMessageId = chat.messages[chat.messages.length - 1]?.id
  // The transcript this channel was ALREADY showing when it opened. A card that
  // was already there is history, not an arrival — without this the effect fired
  // on mount every single time, so opening a channel whose last message happened
  // to be an app threw the app over the conversation before it was read. On a
  // phone the pane is the whole screen, so the channel was never visible at all.
  const settled = useRef(false)
  useEffect(() => {
    settled.current = false
  }, [activeId])
  useEffect(() => {
    if (!lastMessageId) return
    if (!settled.current) {
      settled.current = true
      return
    }
    const last = chat.messages[chat.messages.length - 1]
    if (!last?.app) return
    // The card is threaded under the message that asked for it, so the root of
    // its thread is who asked.
    const ask = chat.messages.find((m) => m.id === last.threadId)
    if (ask?.userId === meId) onOpenApp(last.app.projectId)
    // Keyed on the last message's id ALONE, deliberately: this must fire on the
    // ARRIVAL of a card, not on every re-render that happens to have one at the
    // end — which is what depending on `chat.messages` would do, reopening a
    // pane the member had just closed.
  }, [lastMessageId])

  // A drawer left open while the viewport grew back would cover a sidebar that
  // is already on screen.
  useEffect(() => {
    if (!compact) setDrawerOpen(false)
  }, [compact])

  // Reported, not applied: a browser tab title and an app-icon badge are the
  // same fact told to two very different hosts.
  useEffect(() => {
    onMentionCount?.(chat.totalMentions)
  }, [chat.totalMentions, onMentionCount])

  const roots = useMemo(() => chat.messages.filter((m) => !m.threadId), [chat.messages])
  const repliesOf = useCallback(
    (rootId: string) => chat.messages.filter((m) => m.threadId === rootId),
    [chat.messages],
  )

  const title = channelTitle(channel, chat.directory.members, meId)
  const closeRail = onCloseRail

  const sidebar = (
    <ChannelSidebar
      compact={compact}
      onDismiss={() => setDrawerOpen(false)}
        team={team}
        teams={teams}
        onSwitchTeam={onSwitchTeam}
        channels={chat.channels}
        categories={chat.categories}
        members={chat.directory.members}
        meId={meId}
        activeId={activeId}
        isEditor={isEditor}
        unread={chat.unread}
        onSelect={selectChannel}
        onCreateChannel={(name, categoryId) => void chat.createChannel(name, categoryId)}
        onCreateCategory={(name) => void chat.createCategory(name)}
        onDeleteCategory={(id) => void chat.deleteCategory(id)}
        onMoveChannel={(channelId, categoryId) => void chat.patchChannel(channelId, { categoryId })}
      onOpenDm={(userId) => {
        void chat.openDm(userId).then((channel) => channel && selectChannel(channel.id))
      }}
    />
  )

  return (
    // `relative`, because the rail positions against this when it is covering the
    // surface rather than sitting beside it.
    <Prim.Row height="100%" minWidth={0} position="relative" overflow="hidden">
      {compact ? null : sidebar}

      {/* The drawer. A scrim behind it, so tapping away closes — the gesture
          everybody already has for a panel that slid over what they were reading. */}
      {compact && drawerOpen ? (
        <Prim.Row position="absolute" top={0} left={0} right={0} bottom={0} zIndex={40}>
          {sidebar}
          <Prim.Box
            flex={1}
            backgroundColor="rgba(0,0,0,0.4)"
            onClick={() => setDrawerOpen(false)}
          />
        </Prim.Row>
      ) : null}

      <Prim.Col flex={1} minWidth={0} height="100%">
        <ChannelHeader
          channel={channel}
          title={title}
          {...(channel?.kind === 'dm' ? { subtitle: 'Direct message' } : {})}
          projects={chat.directory.projects}
          rail={rail}
          isEditor={isEditor}
          compact={compact}
          onOpenMenu={() => setDrawerOpen(true)}
          onOpenApp={onOpenApp}
          onAttachApp={(projectId) => {
            void chat.patchChannel(activeId!, { apps: [...(channel?.apps ?? []), projectId] })
            onOpenApp(projectId)
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
              <CloseIcon size={12} />
            </Button>
          </Prim.Row>
        ) : null}

        {/* `Scroll`, not a `Col` with `overflow: auto` — the latter scrolls in a browser and
            CLIPS on a phone, so the conversation ended at the first screenful with no way to
            reach the rest of it. */}
        {/* `Scroll`, not a `Col` with `overflow: auto` — the latter scrolls in a browser and
            CLIPS on a phone, so the conversation ended at the first screenful with no way to
            reach the rest of it. `stickToEnd` is the primitive's job because the two targets pin
            to the bottom by different mechanisms and at different moments. */}
        <Prim.Scroll stickToEnd flex={1} minHeight={0} padding="$4" gap="$4" flexDirection="column">
          {roots.length === 0 ? (
            <ChannelEmptyState
              title={title}
              isDm={channel?.kind === 'dm'}
              onAskThing={() => setPrefill('@thing ')}
            />
          ) : null}
          {roots.map((root, i) => {
            const replies = repliesOf(root.id)
            return (
              <Prim.Col key={root.id} gap="$1">
                <MessageRow
                  message={root}
                  showHeader={showsHeader(roots[i - 1], root)}
                  ctx={ctx}
                  onReply={() => onOpenThread(root.id)}
                />
                <ThreadSummary
                  replies={replies}
                  busy={chat.thinking.has(root.id)}
                  onOpen={() => onOpenThread(root.id)}
                  ctx={ctx}
                />
              </Prim.Col>
            )
          })}
        </Prim.Scroll>

        {chat.typingHere.length > 0 ? <TypingStrip labels={chat.typingHere} /> : null}

        <Composer
          // The `@thing` hint does not fit a phone: the composer is two lines tall, so the
          // placeholder wrapped and the second line was clipped mid-word — the hint made the box
          // look broken instead of teaching anything. It is only dropped where it does not fit;
          // the empty state above still says it, in full, with room to say it.
          placeholder={
            compact
              ? channel?.kind === 'dm'
                ? `Message ${title}`
                : `Message #${title}`
              : channel?.kind === 'dm'
                ? `Message ${title}… (@thing to ask THING)`
                : `Message #${title}… (@thing to ask THING)`
          }
          directory={chat.directory}
          meId={meId}
          disabled={!activeId}
          prefill={prefill}
          onPrefillApplied={() => setPrefill(null)}
          onTyping={() => activeId && chat.notifyTyping(activeId)}
          onSend={(text) => chat.send(text)}
        />
      </Prim.Col>

      {rail?.kind === 'thread' ? (
        <ThreadRail
          root={chat.messages.find((m) => m.id === rail.threadId)}
          replies={repliesOf(rail.threadId)}
          busy={chat.thinking.has(rail.threadId)}
          {...(chat.activity.get(rail.threadId) ? { activity: chat.activity.get(rail.threadId)! } : {})}
          directory={chat.directory}
          meId={meId}
          ctx={ctx}
          compact={compact}
          backLabel={channel?.kind === 'dm' ? title : `#${title}`}
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
          icon={<AppIcon size={14} />}
          headerExtra={<OpenAppExternally url={appUrl(rail.projectId)} />}
          compact={compact}
          backLabel={channel?.kind === 'dm' ? title : `#${title}`}
          onClose={closeRail}
        >
          <AppFrame
            url={appUrl(rail.projectId)}
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
 * What a channel says before anybody has said anything.
 *
 * It replaces two grey sentences. An empty room should tell you what it is FOR and give you the
 * first move — and the first move on this surface is genuinely unusual (a colleague can ask the
 * team's agent to build something, in a message), so it is worth spelling out rather than leaving
 * to a hint in a placeholder that a phone drops for width.
 */
function ChannelEmptyState({
  title,
  isDm,
  onAskThing,
}: {
  title: string
  isDm: boolean
  onAskThing: () => void
}) {
  return (
    <Prim.Col alignItems="center" justifyContent="center" flex={1} gap="$3" padding="$4">
      {/* A `Box` around a `Text` — a Text does not centre its own content on React Native, and the
          glyph rendered in the corner of the circle on a device. */}
      <Prim.Box
        width={56}
        height={56}
        borderRadius="$radius-full"
        backgroundColor="color-mix(in srgb, var(--brand-2) 18%, transparent)"
        display="flex"
        alignItems="center"
        justifyContent="center"
        aria-hidden="true"
      >
        <Prim.Text fontSize="$xl">{isDm ? '👋' : '✦'}</Prim.Text>
      </Prim.Box>
      <Prim.Col alignItems="center" gap="$1">
        <Prim.Text fontSize="$base" fontWeight="$semibold" textAlign="center">
          {isDm ? `You and ${title}` : `#${title} is all yours`}
        </Prim.Text>
        <Prim.Text fontSize="$sm" color="$muted-foreground" textAlign="center" maxWidth={280}>
          {isDm
            ? 'Nothing here yet. Say hello — nobody else can read this.'
            : 'Nothing here yet. Say something, or ask THING to build the team something.'}
        </Prim.Text>
      </Prim.Col>
      {isDm ? null : (
        <Button size="sm" variant="outline" onClick={onAskThing}>
          Ask THING
        </Button>
      )}
    </Prim.Col>
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
  activity,
  directory,
  meId,
  ctx,
  compact,
  backLabel,
  onClose,
  onSend,
  onTyping,
}: {
  root: ChannelMessage | undefined
  replies: ChannelMessage[]
  busy: boolean
  /** THING's live "currently doing" line, shown instead of a bare name. */
  activity?: string
  directory: Directory
  meId: string
  ctx: MessageContext
  compact?: boolean
  backLabel?: string
  onClose: () => void
  onSend: (text: string) => Promise<void>
  onTyping: () => void
}) {
  const groups = useMemo(() => groupMessages(replies), [replies])
  // Once THING has answered in a thread, every reply reaches it without `@thing`
  // — so stop telling people to type it. The server decides the same thing from
  // the thread's session; a `thing` message in the transcript is that decision
  // made visible, which is why this reads the kind rather than re-parsing text.
  const withThing = useMemo(
    () => [root, ...replies].some((m) => m?.kind === 'thing'),
    [root, replies],
  )
  return (
    <RailPane
      title="Thread"
      icon={<ThreadIcon size={14} />}
      compact={compact}
      {...(backLabel ? { backLabel } : {})}
      onClose={onClose}
    >
      {/* `Scroll`, not a `Col` with `overflow: auto` — the same reason the channel transcript is
          one: `overflow` scrolls in a browser and CLIPS under Yoga, so on a phone a thread ended at
          the first screenful and the newest reply was the one you could not reach. */}
      <Prim.Scroll stickToEnd flex={1} minHeight={0} padding="$3" gap="$3" flexDirection="column">
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
        {busy ? <TypingStrip labels={[activity ? `THING — ${activity}` : 'THING']} /> : null}
      </Prim.Scroll>
      <Composer
        // Same reason as the channel composer: the rail is full-width on a phone but the box is
        // still two lines, and the hint is what pushed it over.
        placeholder={
          compact
            ? 'Reply in thread'
            : withThing
              ? 'Reply in thread… THING is listening'
              : 'Reply in thread… (@thing to ask THING)'
        }
        directory={directory}
        meId={meId}
        onTyping={onTyping}
        onSend={onSend}
      />
    </RailPane>
  )
}

/** A named channel is its name; a DM is whoever it is with. */


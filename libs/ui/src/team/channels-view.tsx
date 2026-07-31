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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as Prim from '../elements/primitives/index'
import { Button } from '../elements/forms/button'
import { Caption } from '../elements/typography/caption'
import { onDismiss } from '../platform/keyboard'
import { AppIcon, CloseIcon, ThreadIcon } from './icons'
import { useTeamChat } from './use-team-chat'
import { useTeamLayout } from './use-layout'
import { ChannelSidebar } from './sidebar'
import { Composer, type ComposerProps } from './composer'
import { AppFrame, ChannelHeader, OpenAppExternally, RailPane, RAIL_DEFAULT } from './rail'
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
import type { ChannelMessage, Directory, Rail, ChannelAttachment } from './types'
import type { TeamClient } from './client'

/**
 * Tracks whether a `Scroll` region is pinned to its live edge, and hands back the means to return
 * to it.
 *
 * The transcript used to rely on `stickToEnd` alone, which only ever pins forward — a member who
 * scrolls up to reread something gets swept back down by the very next message with no way back
 * except scrolling by hand. `chat/app/ChatView.tsx` solved this once already for the `/chat`
 * surface; this is the same shape, ported.
 */
function useScrollBottom() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    // DOM metrics — absent on a React Native host instance. Left `atBottom` at its default
    // (`true`) rather than throwing, which just means the button never has reason to appear —
    // the same degradation `ChatView` accepts on the same primitive.
    if (typeof el?.scrollHeight !== 'number') return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
  }, [])
  const jumpToBottom = useCallback(() => {
    const el = ref.current
    el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])
  return { ref, atBottom, onScroll, jumpToBottom }
}

/**
 * Preserves visual scroll position across a PREPEND to a `Scroll` region — what "Load earlier
 * messages" needs, and what it does not get for free.
 *
 * Without this, growing the top of the transcript pushes everything below it down by the height
 * of what was just added, so the reader's eye lands on a random spot mid-page — or, if
 * `stickToEnd` happened to be true, gets yanked to the live edge they were nowhere near reading.
 *
 * `capture()` must run synchronously, BEFORE the state update that will grow the region: it
 * records the anchor as (how tall the region is right now, how far down the reader is in it). The
 * restoring `useLayoutEffect` below then fires once the DOM has the new content — and, because
 * React runs a child's layout effects before its parent's and `Scroll` is a descendant of
 * whatever calls this hook, it fires AFTER `Scroll`'s own `stickToEnd` layout effect. That
 * ordering is what lets it win over a stray snap-to-bottom rather than racing it.
 */
function useScrollAnchor(ref: React.RefObject<HTMLDivElement | null>, dep: unknown) {
  const pending = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const capture = useCallback(() => {
    const el = ref.current
    // DOM metrics — absent on a React Native host instance, same guard `useScrollBottom` uses.
    // Leaving `pending` unset just means the restore below is a no-op: native has no equivalent
    // "jump" to fight in the first place, since `Scroll`'s native fork re-measures on its own
    // `onContentSizeChange` rather than a synchronous `scrollTop` write.
    if (el && typeof el.scrollHeight === 'number') {
      pending.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
    }
  }, [ref])
  useLayoutEffect(() => {
    const anchor = pending.current
    if (!anchor) return
    pending.current = null
    const el = ref.current
    if (!el || typeof el.scrollHeight !== 'number') return
    el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])
  return capture
}

/** "Load earlier messages" — the only way back to history older than the pod's first page. */
function LoadEarlierButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Prim.Pressable
      onClick={onClick}
      disabled={loading}
      alignSelf="center"
      borderRadius="$radius-md"
      borderWidth={1}
      borderColor="$border"
      paddingVertical="$1.5"
      paddingHorizontal="$3"
      opacity={loading ? 0.6 : 1}
      hoverStyle={{ backgroundColor: '$muted' }}
      pressStyle={{ opacity: 0.7 }}
    >
      <Prim.Text fontSize="$xs" fontWeight="$medium" color="$muted-foreground">
        {loading ? 'Loading…' : 'Load earlier messages'}
      </Prim.Text>
    </Prim.Pressable>
  )
}

/** The floating "back to the live edge" control `useScrollBottom` exists to drive. */
function JumpToBottomButton({ onClick }: { onClick: () => void }) {
  return (
    <Prim.Pressable
      onClick={onClick}
      position="absolute"
      bottom="$3"
      right="$3"
      // 44px on both axes — the smallest a control on this surface should be, not just the icon
      // it draws (see `rail.tsx`'s unpin control for what happens when a control IS its glyph).
      width={44}
      height={44}
      borderRadius="$radius-full"
      backgroundColor="$card"
      borderWidth={1}
      borderColor="$border"
      display="flex"
      alignItems="center"
      justifyContent="center"
      zIndex={10}
      pressStyle={{ opacity: 0.7 }}
      hoverStyle={{ backgroundColor: '$muted' }}
      aria-label="Jump to latest messages"
    >
      <Prim.Text fontSize="$base" color="$muted-foreground">
        ↓
      </Prim.Text>
    </Prim.Pressable>
  )
}

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
  // Read by the app-open effect below, off the REF rather than the closure — `profile()`
  // resolving is a race against the socket, and a `[lastMessageId]`-keyed effect only runs once
  // per arrival, so a stale closure value there never gets a second chance.
  const meIdRef = useRef(meId)
  meIdRef.current = meId
  const { compact } = useTeamLayout()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Text a suggestion elsewhere on the surface wants dropped into the composer, cleared as soon as
  // the composer has taken it.
  const [prefill, setPrefill] = useState<string | null>(null)
  // Owned HERE, not inside `RailPane`: the rail unmounts every time it closes (only rendered
  // while `rail` is non-null below), so a `useState` inside it forgot the width on every
  // close/reopen. This component stays mounted for the channel's whole lifetime, which is what
  // makes "remembered for the session" actually true.
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT)
  // `format.ts#relativeTime` is computed at render and never re-ticks on its own — "just now" was
  // right the instant it rendered and then sat there, wrong, until some unrelated state change
  // happened to re-render this tree. Forcing one every minute is cheap (a re-render cascading down
  // to every message row, not a re-fetch of anything) and is the coarsest interval that keeps
  // every label in the transcript honest, since the tightest bucket `relativeTime` has is minutes.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

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

  // Shared by every attachment on screen AND by both composers' staged-preview thumbnails — one
  // function, so a message rendered right after sending it resolves its image the same way the
  // composer that just uploaded it did.
  const resolveAttachmentUrl = useCallback((url: string) => client.attachmentUrl(url), [client])
  const uploadAttachment = useCallback(
    (input: { filename?: string; mediaType: string; data: string }) => client.uploadAttachment(input),
    [client],
  )

  const ctx: MessageContext = useMemo(
    () => ({
      members: chat.directory.members,
      appProjects: new Set(chat.directory.projects.filter((p) => p.hasApp).map((p) => p.id)),
      onOpenApp,
      resolveUrl: resolveAttachmentUrl,
    }),
    [chat.directory, onOpenApp, resolveAttachmentUrl],
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
    if (ask?.userId === meIdRef.current) onOpenApp(last.app.projectId)
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

  // Escape on web, the Android back gesture on native — same seam `Drawer`/`Dialog` already
  // dismiss on (`platform/keyboard`). This drawer is hand-rolled rather than one of those (it
  // slides the whole sidebar over, not a generic panel), so it had never been wired to either —
  // the only way out was finding and tapping the header's close button.
  useEffect(() => {
    if (!compact || !drawerOpen) return
    return onDismiss(() => setDrawerOpen(false))
  }, [compact, drawerOpen])

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

  const transcriptScroll = useScrollBottom()
  const anchorTranscript = useScrollAnchor(transcriptScroll.ref, chat.messages)
  const loadOlder = useCallback(() => {
    anchorTranscript()
    void chat.loadOlder()
  }, [anchorTranscript, chat])

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
            backgroundColor="color-mix(in srgb, var(--foreground) 40%, transparent)"
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

        {/* Only for `reconnecting`, never the initial `connecting` — a fresh page load is
            expected to take a moment, but a socket that WAS live and dropped (a network blip,
            laptop sleep, a pod restart) is worth a member knowing about, since until it heals
            messages/typing/`thing_status` are silently not arriving. */}
        {chat.connection === 'reconnecting' ? (
          <Prim.Row
            alignItems="center"
            gap="$2"
            paddingHorizontal="$4"
            paddingVertical="$1.5"
            backgroundColor="color-mix(in srgb, var(--brand-2) 12%, transparent)"
          >
            <Prim.Text className="lm-pulse" color="$muted-foreground" fontSize="$xs">
              ●
            </Prim.Text>
            <Caption>Reconnecting…</Caption>
          </Prim.Row>
        ) : null}

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
            reach the rest of it. `stickToEnd` is the primitive's job because the two targets pin
            to the bottom by different mechanisms and at different moments — but only while the
            reader is already there: pinned unconditionally, a member scrolled up to reread
            something got swept back down by the very next message with no way back except
            scrolling by hand, which is what `JumpToBottomButton` is for. */}
        {/* `display="flex" flexDirection="column"` is load-bearing, not decoration: `Prim.Box`
            computes to `display: block`, and inside a block container the `Scroll` child's own
            `flex={1} minHeight={0}` means nothing — it sizes to its CONTENT instead of to this
            wrapper, so the region never scrolled at all and the newest messages ran off the
            bottom of the screen, unreachable. This wrapper has to pass the flex constraint
            through, the same way every other height chain in this file does. */}
        <Prim.Box position="relative" flex={1} minHeight={0} display="flex" flexDirection="column">
          <Prim.Scroll
            ref={transcriptScroll.ref}
            onScroll={transcriptScroll.onScroll}
            stickToEnd={transcriptScroll.atBottom}
            flex={1}
            minHeight={0}
            padding="$4"
            gap="$4"
            flexDirection="column"
          >
            {/* `!chat.loading`, not just `roots.length === 0` — the history fetch clears
                `messages` synchronously and resolves later, so without the loading guard every
                channel switch flashed this "nothing here yet" state for the round trip. Nothing
                renders in its place while loading rather than a spinner: one was tried and it
                only ever flashed for the ~30ms a fetch usually takes, which read as a glitch
                rather than as feedback. */}
            {/* At the TOP, above every root message — this is where older history reappears.
                Hidden while `chat.loading` for the same reason the empty state is: the fetch for
                a freshly-selected channel has not settled yet, and `hasMore` is still the
                PREVIOUS channel's until it does (or `false`, right after the switch — see
                `use-team-chat.ts`'s reset). Showing it then would offer to page a channel that
                is not even on screen yet. */}
            {!chat.loading && chat.hasMore ? (
              <LoadEarlierButton loading={chat.loadingOlder} onClick={loadOlder} />
            ) : null}
            {!chat.loading && roots.length === 0 ? (
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
          {!transcriptScroll.atBottom ? (
            <JumpToBottomButton onClick={transcriptScroll.jumpToBottom} />
          ) : null}
        </Prim.Box>

        {chat.typingHere.length > 0 ? <TypingStrip labels={chat.typingHere} /> : null}

        <Composer
          // Keyed on the channel: with no key React reuses the same instance across a switch and
          // its internal `draft`/`mention` state (see `composer.tsx`) came along with it — typing
          // in #general and then clicking #random left #general's half-written message sitting in
          // the box, one send away from going to the wrong channel. A new key forces a fresh
          // instance (and an empty draft) per channel instead.
          key={activeId ?? 'no-channel'}
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
          onSend={(text, attachments) => chat.send(text, undefined, attachments)}
          onUpload={uploadAttachment}
          resolveUrl={resolveAttachmentUrl}
        />
      </Prim.Col>

      {rail?.kind === 'thread' ? (
        <ThreadRail
          // Keyed on the thread: without it, switching from one thread's rail to another reused
          // the same mounted instance — and with it, the same composer instance and the draft
          // sitting inside it. Same bug and same fix as the channel composer above.
          key={rail.threadId}
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
          onSend={(text, attachments) => chat.send(text, rail.threadId, attachments)}
          onUpload={uploadAttachment}
          resolveUrl={resolveAttachmentUrl}
          onTyping={() => activeId && chat.notifyTyping(activeId)}
          width={railWidth}
          onWidthChange={setRailWidth}
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
          width={railWidth}
          onWidthChange={setRailWidth}
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
  onUpload,
  resolveUrl,
  onTyping,
  width,
  onWidthChange,
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
  onSend: (text: string, attachments?: ChannelAttachment[]) => Promise<void>
  /** Forwarded to the thread's own `Composer` — see `ComposerProps.onUpload`. A message that
   *  addresses THING here needs to carry an attachment the same way a channel message does, so
   *  the agent can see the image or read the file. */
  onUpload: ComposerProps['onUpload']
  resolveUrl: ComposerProps['resolveUrl']
  onTyping: () => void
  /** Forwarded straight to `RailPane` — owned by `TeamChannelsView`, see its own note. */
  width: number
  onWidthChange: (width: number) => void
}) {
  const groups = useMemo(() => groupMessages(replies), [replies])
  const threadScroll = useScrollBottom()
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
      width={width}
      onWidthChange={onWidthChange}
    >
      {/* `Scroll`, not a `Col` with `overflow: auto` — the same reason the channel transcript is
          one: `overflow` scrolls in a browser and CLIPS under Yoga, so on a phone a thread ended at
          the first screenful and the newest reply was the one you could not reach. Same
          jump-to-bottom reasoning as the channel transcript, too — a busy thread can run long.
          `display="flex" flexDirection="column"` on this wrapper for the same reason as the
          channel transcript's: `Prim.Box` is `display: block`, and inside a block container the
          `Scroll` child's `flex={1} minHeight={0}` sizes it to its CONTENT, not to this wrapper —
          the thread never scrolled and the newest reply ran off the bottom, unreachable. */}
      <Prim.Box position="relative" flex={1} minHeight={0} display="flex" flexDirection="column">
        <Prim.Scroll
          ref={threadScroll.ref}
          onScroll={threadScroll.onScroll}
          stickToEnd={threadScroll.atBottom}
          flex={1}
          minHeight={0}
          padding="$3"
          gap="$3"
          flexDirection="column"
        >
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
        {!threadScroll.atBottom ? <JumpToBottomButton onClick={threadScroll.jumpToBottom} /> : null}
      </Prim.Box>
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
        onUpload={onUpload}
        resolveUrl={resolveUrl}
      />
    </RailPane>
  )
}

/** A named channel is its name; a DM is whoever it is with. */


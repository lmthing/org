/**
 * How one channel message is drawn, and how a run of them collapses.
 *
 * Slack/Discord-style — left-aligned, avatar + name + timestamp, consecutive
 * messages from one sender folded under a single header — and deliberately NOT
 * the chat surface's right-aligned "mine vs theirs" bubbles. A channel is
 * multi-party, so "which side is mine" answers a question nobody asked; what a
 * reader needs is who said it and when.
 */

import * as Prim from '@lmthing/ui/elements/primitives'
import { renderDescriptor, toRenderableDescriptor } from '@lmthing/ui/chat'
import { Markdown } from '@lmthing/ui/elements/content/markdown'
import { Avatar, AvatarFallback } from '@lmthing/ui/elements/content/avatar'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { AppWindow, MessageSquare } from 'lucide-react'
import { memberLabel, type ChannelMessage, type MemberProfile } from '@/lib/team-pod'
import { initials, relativeTime } from '@/lib/team-format'

/** Consecutive same-sender messages within this window collapse under one
 * avatar/name/timestamp header. */
const GROUP_WINDOW_MS = 5 * 60_000

export interface MessageGroup {
  key: string
  kind: ChannelMessage['kind']
  senderId: string
  email?: string
  messages: ChannelMessage[]
}

export function senderKey(m: ChannelMessage): string {
  return m.kind === 'thing'
    ? 'thing'
    : m.kind === 'system'
      ? 'system'
      : (m.userId ?? m.email ?? 'unknown')
}

function sameSender(a: ChannelMessage, b: ChannelMessage): boolean {
  return a.kind === b.kind && senderKey(a) === senderKey(b)
}

/** Whether `cur` should get its own avatar/name/timestamp header, vs. stacking
 * quietly under the previous message's header. */
export function showsHeader(prev: ChannelMessage | undefined, cur: ChannelMessage): boolean {
  if (!prev) return true
  if (!sameSender(prev, cur)) return true
  return new Date(cur.ts).getTime() - new Date(prev.ts).getTime() >= GROUP_WINDOW_MS
}

/**
 * Fold a run of consecutive same-sender messages into one group — one
 * avatar/header, several bodies underneath.
 *
 * Used for the messages INSIDE a thread, where every message is a reply and none
 * of them can be opened further, so collapsing several under one header loses no
 * affordance. The channel's own root messages are rendered individually, because
 * each of them can open a thread and grouping would hide that on all but the
 * last.
 */
export function groupMessages(msgs: ChannelMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const m of msgs) {
    const last = groups[groups.length - 1]
    const lastMsg = last?.messages[last.messages.length - 1]
    if (last && lastMsg && !showsHeader(lastMsg, m)) last.messages.push(m)
    else groups.push({ key: m.id, kind: m.kind, senderId: senderKey(m), email: m.email, messages: [m] })
  }
  return groups
}

/** How this surface addresses the agent — the same literal the pod matches on. */
const THING_HANDLE = 'thing'

export interface MessageContext {
  /** The directory, for turning a user id or an `@handle` into a name. */
  members: MemberProfile[]
  /** Project ids that have something openable, so only those become chips. */
  appProjects: Set<string>
  /** Open a project's app in the rail. */
  onOpenApp: (projectId: string) => void
}

function labelFor(members: MemberProfile[], userId?: string, email?: string): string {
  const member = members.find((m) => m.userId === userId)
  return memberLabel(member, email ?? userId ?? 'Someone')
}

/**
 * Draw an `@…` in a member's own prose as a chip.
 *
 * Only mentions that RESOLVE are chipped — to a member's handle, to THING, or to
 * a project with an app. An `@` that names nothing is left exactly as typed,
 * because it is then just a character somebody wrote and restyling it would be
 * inventing a reference that is not there.
 */
function withMentions(text: string, ctx: MessageContext) {
  const byHandle = new Map(ctx.members.filter((m) => m.handle).map((m) => [m.handle!, m]))
  const parts: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  for (const match of text.matchAll(/(^|\s)@([a-zA-Z0-9][a-zA-Z0-9._-]{1,63})/g)) {
    const at = (match.index ?? 0) + match[1]!.length
    const raw = match[2]!
    const lowered = raw.toLowerCase()
    const member = byHandle.get(lowered)
    const isThing = lowered === THING_HANDLE
    const project = ctx.appProjects.has(raw) ? raw : ctx.appProjects.has(lowered) ? lowered : null
    if (!member && !isThing && !project) continue

    if (at > cursor) parts.push(text.slice(cursor, at))
    const label = member ? memberLabel(member, `@${raw}`) : isThing ? 'THING' : `@${raw}`
    parts.push(
      <Prim.Text
        key={`m${key++}`}
        fontSize="$sm"
        fontWeight="$medium"
        color="$primary"
        backgroundColor="color-mix(in srgb, var(--primary) 12%, transparent)"
        borderRadius="$radius-sm"
        paddingHorizontal="$1"
        {...(project
          ? { cursor: 'pointer', onClick: () => ctx.onOpenApp(project) }
          : {})}
      >
        {project ? `◱ ${raw}` : label}
      </Prim.Text>,
    )
    cursor = at + raw.length + 1
  }
  if (!parts.length) return text
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

/**
 * The body of one channel message.
 *
 * THING answers in JSX, so a `thing` message is usually a tree of design-system
 * components rather than a paragraph — it carries `blocks`, and those go through
 * the SAME `renderDescriptor` the `/chat` transcript uses, so an answer looks the
 * same wherever it is read.
 *
 * `blocks` is recent and the channel log is append-only, so a thread from before
 * it existed still holds the descriptor stringified into `text` — parse that back
 * rather than showing a member the braces forever.
 *
 * A member's own message is prose and stays prose: rendering a colleague's text
 * as markdown would let a stray `#` or `_` restyle what they typed. Mentions are
 * the one thing lifted out of it, because they are references, not formatting.
 */
export function MessageBody({ message, ctx }: { message: ChannelMessage; ctx: MessageContext }) {
  const blocks = message.blocks?.length ? message.blocks : null
  const legacy = blocks ? null : toRenderableDescriptor(message.text)
  const descriptors = blocks ?? legacy

  if (descriptors) return <Prim.Col gap="$1">{renderDescriptor(descriptors)}</Prim.Col>
  if (message.kind === 'thing') return <Markdown source={message.text} preset="prose" />
  return (
    <Prim.Text fontSize="$sm" whiteSpace="pre-wrap">
      {withMentions(message.text, ctx)}
    </Prim.Text>
  )
}

export function SenderAvatar({
  kind,
  senderId,
  label,
}: {
  kind: ChannelMessage['kind']
  senderId: string
  label: string
}) {
  if (kind === 'thing') {
    return (
      <Prim.Text
        backgroundColor="color-mix(in srgb, var(--brand-2) 20%, transparent)"
        flexShrink={0}
        width="$8"
        height="$8"
        borderRadius="$radius-full"
        alignItems="center"
        justifyContent="center"
        fontSize="$sm"
        userSelect="none"
        display="flex"
        aria-hidden="true"
      >
        ✦
      </Prim.Text>
    )
  }
  return (
    <Avatar size="sm">
      <AvatarFallback colorKey={senderId}>{initials(label)}</AvatarFallback>
    </Avatar>
  )
}

function MessageHeader({
  kind,
  who,
  ts,
}: {
  kind: ChannelMessage['kind']
  who: string
  ts: string
}) {
  return (
    <Prim.Row alignItems="baseline" gap="$2">
      <Prim.Text
        fontSize="$sm"
        fontWeight="$medium"
        color={kind === 'thing' ? '$primary' : '$foreground'}
      >
        {kind === 'thing' ? 'THING' : who}
      </Prim.Text>
      <Caption>{relativeTime(new Date(ts).getTime())}</Caption>
    </Prim.Row>
  )
}

/**
 * The card posted when THING finishes building an app.
 *
 * It lives in the LOG, not only in a toast, so the conversation that produced an
 * app still shows what it produced when somebody scrolls back to it a week
 * later — and offers, right there, to open it beside the channel.
 */
function AppCard({ message, ctx }: { message: ChannelMessage; ctx: MessageContext }) {
  const app = message.app!
  return (
    <Prim.Row
      alignItems="center"
      gap="$3"
      alignSelf="flex-start"
      borderWidth={1}
      borderColor="$border"
      borderRadius="$radius-md"
      backgroundColor="$muted"
      paddingVertical="$2"
      paddingHorizontal="$3"
    >
      <Prim.Box
        width="$8"
        height="$8"
        borderRadius="$radius-md"
        backgroundColor="color-mix(in srgb, var(--brand-2) 20%, transparent)"
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <AppWindow size={16} aria-hidden={true} />
      </Prim.Box>
      <Prim.Col gap="$0.5">
        <Prim.Text fontSize="$sm" fontWeight="$medium">
          {app.name}
        </Prim.Text>
        <Caption>Ready — pinned to this channel</Caption>
      </Prim.Col>
      <Button size="sm" variant="outline" onClick={() => ctx.onOpenApp(app.projectId)}>
        Open
      </Button>
    </Prim.Row>
  )
}

function SystemMessage({ message, ctx }: { message: ChannelMessage; ctx: MessageContext }) {
  if (message.app) return <AppCard message={message} ctx={ctx} />
  return (
    <Prim.Text fontSize="$xs" color="$muted-foreground" fontStyle="italic" textAlign="center">
      {message.text}
    </Prim.Text>
  )
}

/**
 * One message with a header only when `showHeader` — used for a channel's ROOT
 * messages, one component per message so the thread affordance is never lost to
 * visual grouping.
 */
export function MessageRow({
  message,
  showHeader,
  ctx,
}: {
  message: ChannelMessage
  showHeader: boolean
  ctx: MessageContext
}) {
  if (message.kind === 'system') return <SystemMessage message={message} ctx={ctx} />
  if (!showHeader) {
    return (
      <Prim.Box paddingLeft="$11">
        <MessageBody message={message} ctx={ctx} />
      </Prim.Box>
    )
  }
  const who = labelFor(ctx.members, message.userId, message.email)
  return (
    <Prim.Row gap="$3" alignItems="flex-start">
      <SenderAvatar kind={message.kind} senderId={senderKey(message)} label={who} />
      <Prim.Col flex={1} minWidth={0} gap="$1">
        <MessageHeader kind={message.kind} who={who} ts={message.ts} />
        <MessageBody message={message} ctx={ctx} />
      </Prim.Col>
    </Prim.Row>
  )
}

/** A collapsed run of consecutive same-sender messages under one header. */
export function MessageGroupView({ group, ctx }: { group: MessageGroup; ctx: MessageContext }) {
  if (group.kind === 'system') {
    return (
      <Prim.Col gap="$1" alignItems={group.messages.some((m) => m.app) ? 'flex-start' : 'center'}>
        {group.messages.map((m) => (
          <SystemMessage key={m.id} message={m} ctx={ctx} />
        ))}
      </Prim.Col>
    )
  }
  const first = group.messages[0]
  const who = labelFor(ctx.members, first.userId, group.email)
  return (
    <Prim.Row gap="$3" alignItems="flex-start">
      <SenderAvatar kind={group.kind} senderId={group.senderId} label={who} />
      <Prim.Col flex={1} minWidth={0} gap="$1">
        <MessageHeader kind={group.kind} who={who} ts={first.ts} />
        {group.messages.map((m) => (
          <MessageBody key={m.id} message={m} ctx={ctx} />
        ))}
      </Prim.Col>
    </Prim.Row>
  )
}

/**
 * The "3 replies" strip under a root message — Slack's thread affordance.
 *
 * It shows the faces in the thread and when it was last touched, because that is
 * what makes an unopened thread worth opening: who is in it, and whether it is
 * still moving.
 */
export function ThreadSummary({
  replies,
  busy,
  onOpen,
  ctx,
}: {
  replies: ChannelMessage[]
  busy: boolean
  onOpen: () => void
  ctx: MessageContext
}) {
  if (!replies.length && !busy) {
    return (
      <Prim.Pressable onClick={onOpen} alignSelf="flex-start" marginLeft="$11" opacity={0.6} hoverStyle={{ opacity: 1 }}>
        <Prim.Row alignItems="center" gap="$1.5">
          <MessageSquare size={12} aria-hidden={true} />
          <Caption>Reply in thread</Caption>
        </Prim.Row>
      </Prim.Pressable>
    )
  }
  const faces = [...new Map(replies.map((m) => [senderKey(m), m])).values()].slice(0, 3)
  const last = replies[replies.length - 1]
  return (
    <Prim.Pressable
      onClick={onOpen}
      alignSelf="flex-start"
      marginLeft="$11"
      borderRadius="$radius-md"
      paddingVertical="$1"
      paddingHorizontal="$1.5"
      hoverStyle={{ backgroundColor: '$muted' }}
    >
      <Prim.Row alignItems="center" gap="$2">
        {faces.map((m) => (
          <SenderAvatar
            key={m.id}
            kind={m.kind}
            senderId={senderKey(m)}
            label={labelFor(ctx.members, m.userId, m.email)}
          />
        ))}
        <Prim.Text fontSize="$xs" fontWeight="$medium" color="$primary">
          {replies.length === 1 ? '1 reply' : `${replies.length} replies`}
        </Prim.Text>
        <Caption>{busy ? 'THING is working…' : last ? relativeTime(new Date(last.ts).getTime()) : ''}</Caption>
      </Prim.Row>
    </Prim.Pressable>
  )
}

/** A pulsing-dot strip — "something is happening" kept out of the transcript. */
export function TypingStrip({ labels }: { labels: string[] }) {
  const text =
    labels.length === 1
      ? `${labels[0]} is typing…`
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]} are typing…`
        : `${labels.length} people are typing…`
  return (
    <Prim.Row gap="$1.5" alignItems="center" paddingHorizontal="$4" paddingVertical="$1">
      <Prim.Text className="lm-pulse" color="$primary" fontSize="$xs">
        ●
      </Prim.Text>
      <Caption>{text}</Caption>
    </Prim.Row>
  )
}

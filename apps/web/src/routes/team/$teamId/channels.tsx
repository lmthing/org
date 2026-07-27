import * as Prim from '@lmthing/ui/elements/primitives'
import { Markdown } from '@lmthing/ui/elements/content/markdown'
import { ListItem } from '@lmthing/ui/elements/content/list-item'
import { Separator } from '@lmthing/ui/elements/content/separator'
import { Avatar, AvatarFallback } from '@lmthing/ui/elements/content/avatar'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hash, Plus, Send } from 'lucide-react'
import { useTeamAuth, teamWsTokenSuffix, type TeamAuth } from '@/lib/team-auth'
import { initials, relativeTime } from '@/lib/team-format'

/**
 * The team's chat: channels down the side, a transcript in the middle, threads
 * opened in a rail. Members talk to each other here and call THING with an
 * `@thing` mention; it answers in the thread and remembers the conversation
 * across messages.
 *
 * All of this talks to the TEAM's pod at the same origin — Envoy routes
 * lmthing.team by the team claim in the token this surface holds.
 */

interface Channel {
  id: string
  name: string
}

interface ChannelMessage {
  id: string
  ts: string
  channelId: string
  kind: 'user' | 'thing' | 'system'
  text: string
  userId?: string
  email?: string
  threadId?: string
}

type ChannelEvent =
  | { type: 'message'; message: ChannelMessage }
  | { type: 'thing_status'; channelId: string; threadId: string; status: string }
  | { type: 'typing'; channelId: string; userId: string }

/** How long a `typing` event is believed without a follow-up (the server has
 * no explicit "stopped typing" event — it just stops sending). */
const TYPING_TTL_MS = 4000

/** Consecutive same-sender messages within this window collapse under one
 * avatar/name/timestamp header, Slack-style. */
const GROUP_WINDOW_MS = 5 * 60_000

async function podFetch(
  team: TeamAuth,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await team.getTeamToken()
  return fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  })
}

interface MessageGroup {
  key: string
  kind: ChannelMessage['kind']
  senderId: string
  email?: string
  messages: ChannelMessage[]
}

function senderKey(m: ChannelMessage): string {
  return m.kind === 'thing' ? 'thing' : m.kind === 'system' ? 'system' : (m.userId ?? m.email ?? 'unknown')
}

function sameSender(a: ChannelMessage, b: ChannelMessage): boolean {
  return a.kind === b.kind && senderKey(a) === senderKey(b)
}

/** Whether `cur` should get its own avatar/name/timestamp header, vs. stacking
 * quietly under the previous message's header (Slack-style run collapsing). */
function showsHeader(prev: ChannelMessage | undefined, cur: ChannelMessage): boolean {
  if (!prev) return true
  if (!sameSender(prev, cur)) return true
  return new Date(cur.ts).getTime() - new Date(prev.ts).getTime() >= GROUP_WINDOW_MS
}

/**
 * Fold a run of consecutive same-sender messages (within GROUP_WINDOW_MS)
 * into one group — one avatar/header, several message bodies underneath.
 *
 * Only safe for REPLIES: a reply can never itself be a thread root (this data
 * model has no reply-to-a-reply), so collapsing several into one header loses
 * no per-message affordance. Root messages are rendered individually instead
 * (see `showsHeader`) because any one of them can be its own thread with its
 * own replies — grouping them would hide that on every message but the last.
 */
function groupMessages(msgs: ChannelMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const m of msgs) {
    const senderId = senderKey(m)
    const last = groups[groups.length - 1]
    const lastMsg = last?.messages[last.messages.length - 1]
    if (last && lastMsg && showsHeader(lastMsg, m) === false) {
      last.messages.push(m)
    } else {
      groups.push({ key: m.id, kind: m.kind, senderId, email: m.email, messages: [m] })
    }
  }
  return groups
}

function ChannelsPage() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const team = useTeamAuth()
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [draft, setDraft] = useState('')
  const [thread, setThread] = useState<string | null>(null)
  const [thinking, setThinking] = useState<Set<string>>(new Set())
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map()) // userId -> channelId
  const [error, setError] = useState<string | null>(null)
  const [newChannel, setNewChannel] = useState('')
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load channels once the team pod is reachable.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await podFetch(team, '/api/team/channels')
        if (!res.ok) throw new Error(`channels: ${res.status}`)
        const data = (await res.json()) as { channels: Channel[] }
        if (cancelled) return
        setChannels(data.channels)
        setActiveId((current) => current ?? data.channels[0]?.id ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [team, teamId])

  // History for the selected channel.
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setMessages([])
    setThread(null)
    void (async () => {
      try {
        const res = await podFetch(team, `/api/team/channels/${activeId}/messages`)
        if (!res.ok) throw new Error(`history: ${res.status}`)
        const data = (await res.json()) as { messages: ChannelMessage[] }
        if (!cancelled) setMessages(data.messages)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeId, team])

  // One socket for the whole surface: the pod broadcasts every channel's events
  // and we keep the ones for the channel on screen.
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${window.location.host}/api/team/ws?t=1${teamWsTokenSuffix(team)}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      return
    }
    ws.onmessage = (event) => {
      let parsed: ChannelEvent
      try {
        parsed = JSON.parse(String(event.data)) as ChannelEvent
      } catch {
        return
      }
      if (parsed.type === 'message') {
        const incoming = parsed.message
        setMessages((prev) =>
          prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
        )
        setTypingUsers((prev) => {
          if (!incoming.userId || !prev.has(incoming.userId)) return prev
          const next = new Map(prev)
          next.delete(incoming.userId)
          return next
        })
      } else if (parsed.type === 'thing_status') {
        setThinking((prev) => {
          const next = new Set(prev)
          if (parsed.status === 'running') next.add(parsed.threadId)
          else next.delete(parsed.threadId)
          return next
        })
      } else if (parsed.type === 'typing') {
        setTypingUsers((prev) => new Map(prev).set(parsed.userId, parsed.channelId))
        const existing = typingTimers.current.get(parsed.userId)
        if (existing) clearTimeout(existing)
        typingTimers.current.set(
          parsed.userId,
          setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Map(prev)
              next.delete(parsed.userId)
              return next
            })
            typingTimers.current.delete(parsed.userId)
          }, TYPING_TTL_MS),
        )
      }
    }
    const timers = typingTimers.current
    return () => {
      ws.close()
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [team])

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || !activeId) return
    setDraft('')
    requestAnimationFrame(adjustHeight)
    try {
      const res = await podFetch(team, `/api/team/channels/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text, ...(thread ? { threadId: thread } : {}) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `send failed (${res.status})`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDraft(text)
    }
  }, [draft, activeId, thread, team, adjustHeight])

  const createChannel = async () => {
    const name = newChannel.trim()
    if (!name) return
    try {
      const res = await podFetch(team, '/api/team/channels', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `could not create the channel (${res.status})`)
      }
      const data = (await res.json()) as { channel: Channel }
      setNewChannel('')
      setChannels((prev) =>
        prev.some((c) => c.id === data.channel.id) ? prev : [...prev, data.channel],
      )
      setActiveId(data.channel.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // A channel-level message opens its own thread; replies hang off it.
  const visible = useMemo(
    () => messages.filter((m) => m.channelId === activeId),
    [messages, activeId],
  )
  const roots = useMemo(() => visible.filter((m) => !m.threadId), [visible])
  const repliesOf = useCallback(
    (rootId: string) => visible.filter((m) => m.threadId === rootId),
    [visible],
  )

  // Best-effort display name for a typing indicator: the most recent message
  // seen from that user in this channel.
  const emailByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of visible) if (m.userId && m.email) map.set(m.userId, m.email)
    return map
  }, [visible])
  const typingInChannel = useMemo(
    () =>
      [...typingUsers.entries()]
        .filter(([, channelId]) => channelId === activeId)
        .map(([userId]) => emailByUserId.get(userId) ?? 'Someone'),
    [typingUsers, activeId, emailByUserId],
  )

  return (
    <Prim.Row height="100%">
      <Prim.Col
        width={200}
        borderRightWidth={1}
        borderColor="$border"
        padding="$2"
        gap="$0.5"
        overflow="auto"
      >
        {channels.map((channel) => (
          <ListItem
            key={channel.id}
            selected={channel.id === activeId}
            onClick={() => setActiveId(channel.id)}
          >
            <Hash size={14} aria-hidden={true} />
            <Prim.Text fontSize="$sm" marginLeft="$1.5">
              {channel.name}
            </Prim.Text>
          </ListItem>
        ))}
        {team.role === 'editor' ? (
          <Prim.Row gap="$1" marginTop="$2" paddingHorizontal="$1">
            <Input
              size="sm"
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              placeholder="New channel"
              flex={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createChannel()
              }}
            />
            <Button size="icon" variant="ghost" onClick={() => void createChannel()}>
              <Plus size={14} aria-hidden={true} />
            </Button>
          </Prim.Row>
        ) : null}
      </Prim.Col>

      <Prim.Col flex={1} minWidth={0}>
        {error ? (
          <Prim.Text color="$destructive" fontSize="$xs" padding="$2">
            {error}
          </Prim.Text>
        ) : null}
        <Prim.Col flex={1} overflow="auto" padding="$4" gap="$4">
          {roots.length === 0 ? (
            <Prim.Text color="$muted-foreground" fontSize="$sm">
              Nothing here yet. Say something — mention @thing to bring THING in.
            </Prim.Text>
          ) : null}
          {roots.map((root, i) => {
            const replies = repliesOf(root.id)
            const replyGroups = groupMessages(replies)
            return (
              <Prim.Col key={root.id} gap="$1">
                <MessageRow message={root} showHeader={showsHeader(roots[i - 1], root)} />
                {replyGroups.length > 0 || thinking.has(root.id) ? (
                  <Prim.Col marginLeft="$8" paddingLeft="$3" gap="$3">
                    <Separator />
                    {replyGroups.map((rg) => (
                      <MessageGroupView key={rg.key} group={rg} />
                    ))}
                    {thinking.has(root.id) ? <TypingStrip labels={['THING']} /> : null}
                  </Prim.Col>
                ) : null}
                <Prim.Pressable
                  onClick={() => setThread(thread === root.id ? null : root.id)}
                  alignSelf="flex-start"
                  marginLeft="$11"
                >
                  <Prim.Text fontSize="$xs" color="$muted-foreground">
                    {thread === root.id ? 'replying in thread — cancel' : 'reply in thread'}
                  </Prim.Text>
                </Prim.Pressable>
              </Prim.Col>
            )
          })}
        </Prim.Col>

        {typingInChannel.length > 0 ? <TypingStrip labels={typingInChannel} /> : null}

        <Prim.Row gap="$2" padding="$3" borderTopWidth={1} borderColor="$border" alignItems="flex-end">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              adjustHeight()
            }}
            placeholder={
              thread ? 'Reply in thread… (@thing to ask THING)' : 'Message… (@thing to ask THING)'
            }
            flex={1}
            rows={1}
            minHeight="$9"
            resize="none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <Button size="icon" onClick={() => void send()} disabled={!draft.trim()}>
            <Send size={14} aria-hidden={true} />
          </Button>
        </Prim.Row>
      </Prim.Col>
    </Prim.Row>
  )
}

/** A pulsing-dot strip above the composer — mirrors the chat surface's
 * LiveActivity treatment for "something is happening" (THING thinking, or a
 * teammate typing), kept out of the transcript itself. */
function TypingStrip({ labels }: { labels: string[] }) {
  const text =
    labels.length === 1
      ? `${labels[0]} is typing…`
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]} are typing…`
        : `${labels.length} people are typing…`
  return (
    <Prim.Row
      gap="$1.5"
      alignItems="center"
      paddingHorizontal="$4"
      paddingVertical="$1"
      fontSize="$xs"
      color="$muted-foreground"
    >
      <Prim.Text className="lm-pulse" color="$primary">
        ●
      </Prim.Text>
      <Prim.Text fontSize="$xs" color="$muted-foreground">
        {text}
      </Prim.Text>
    </Prim.Row>
  )
}

function SenderAvatar({ kind, senderId, email }: { kind: ChannelMessage['kind']; senderId: string; email?: string }) {
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
      <AvatarFallback colorKey={senderId}>{initials(email ?? senderId)}</AvatarFallback>
    </Avatar>
  )
}

/** The avatar/name/timestamp row shared by a single root message and a
 * collapsed reply group. */
function MessageHeader({
  kind,
  senderId,
  email,
  ts,
}: {
  kind: ChannelMessage['kind']
  senderId: string
  email?: string
  ts: string
}) {
  const who = kind === 'thing' ? 'THING' : (email ?? senderId)
  return (
    <Prim.Row alignItems="baseline" gap="$2">
      <Prim.Text fontSize="$sm" fontWeight="$medium" color={kind === 'thing' ? '$primary' : '$foreground'}>
        {who}
      </Prim.Text>
      <Prim.Text fontSize="$xs" color="$muted-foreground">
        {relativeTime(new Date(ts).getTime())}
      </Prim.Text>
    </Prim.Row>
  )
}

/** A body row, with a header (avatar/name/timestamp) only when `showHeader` —
 * used for ROOT messages, one per exact message so thread affordance never
 * gets lost to visual grouping (see `groupMessages`'s docstring). */
function MessageRow({ message, showHeader }: { message: ChannelMessage; showHeader: boolean }) {
  if (message.kind === 'system') {
    return (
      <Prim.Text fontSize="$xs" color="$muted-foreground" fontStyle="italic" textAlign="center">
        {message.text}
      </Prim.Text>
    )
  }
  if (!showHeader) {
    return (
      <Prim.Box paddingLeft="$11">
        <Markdown source={message.text} preset="prose" />
      </Prim.Box>
    )
  }
  return (
    <Prim.Row gap="$3" alignItems="flex-start">
      <SenderAvatar kind={message.kind} senderId={senderKey(message)} email={message.email} />
      <Prim.Col flex={1} minWidth={0} gap="$1">
        <MessageHeader kind={message.kind} senderId={senderKey(message)} email={message.email} ts={message.ts} />
        <Markdown source={message.text} preset="prose" />
      </Prim.Col>
    </Prim.Row>
  )
}

/** A collapsed run of consecutive same-sender REPLIES under one header — safe
 * because a reply can't itself have a thread (see `groupMessages`). */
function MessageGroupView({ group }: { group: MessageGroup }) {
  if (group.kind === 'system') {
    return (
      <Prim.Col gap="$0.5" alignItems="center">
        {group.messages.map((m) => (
          <Prim.Text key={m.id} fontSize="$xs" color="$muted-foreground" fontStyle="italic">
            {m.text}
          </Prim.Text>
        ))}
      </Prim.Col>
    )
  }
  const first = group.messages[0]
  return (
    <Prim.Row gap="$3" alignItems="flex-start">
      <SenderAvatar kind={group.kind} senderId={group.senderId} email={group.email} />
      <Prim.Col flex={1} minWidth={0} gap="$1">
        <MessageHeader kind={group.kind} senderId={group.senderId} email={group.email} ts={first.ts} />
        {group.messages.map((m) => (
          <Markdown key={m.id} source={m.text} preset="prose" />
        ))}
      </Prim.Col>
    </Prim.Row>
  )
}

export const Route = createFileRoute('/team/$teamId/channels')({
  component: ChannelsPage,
})

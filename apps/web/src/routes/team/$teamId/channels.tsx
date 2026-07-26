import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTeamAuth, teamWsTokenSuffix, type TeamAuth } from '@/lib/team-auth'

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

function ChannelsPage() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const team = useTeamAuth()
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [draft, setDraft] = useState('')
  const [thread, setThread] = useState<string | null>(null)
  const [thinking, setThinking] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [newChannel, setNewChannel] = useState('')

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
      } else if (parsed.type === 'thing_status') {
        setThinking((prev) => {
          const next = new Set(prev)
          if (parsed.status === 'running') next.add(parsed.threadId)
          else next.delete(parsed.threadId)
          return next
        })
      }
    }
    return () => ws.close()
  }, [team])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || !activeId) return
    setDraft('')
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
  }, [draft, activeId, thread, team])

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

  return (
    <Prim.Row height="100%">
      <Prim.Col
        width={200}
        borderRightWidth={1}
        borderColor="$border"
        padding="$3"
        gap="$1"
        overflow="auto"
      >
        {channels.map((channel) => (
          <Prim.Pressable
            key={channel.id}
            onClick={() => setActiveId(channel.id)}
            paddingHorizontal="$2"
            paddingVertical="$1"
            borderRadius="$sm"
            backgroundColor={channel.id === activeId ? '$accent' : 'transparent'}
          >
            <Prim.Text fontSize="$sm"># {channel.name}</Prim.Text>
          </Prim.Pressable>
        ))}
        {team.role === 'editor' ? (
          <Prim.Row gap="$1" marginTop="$2">
            <Prim.TextField
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              placeholder="New channel"
              flex={1}
            />
            <Prim.Pressable onClick={() => void createChannel()} padding="$1">
              <Prim.Text fontSize="$sm">+</Prim.Text>
            </Prim.Pressable>
          </Prim.Row>
        ) : null}
      </Prim.Col>

      <Prim.Col flex={1} minWidth={0}>
        {error ? (
          <Prim.Text color="$destructive" fontSize="$xs" padding="$2">
            {error}
          </Prim.Text>
        ) : null}
        <Prim.Col flex={1} overflow="auto" padding="$4" gap="$3">
          {roots.length === 0 ? (
            <Prim.Text color="$muted-foreground" fontSize="$sm">
              Nothing here yet. Say something — mention @thing to bring THING in.
            </Prim.Text>
          ) : null}
          {roots.map((message) => {
            const replies = repliesOf(message.id)
            return (
              <Prim.Col key={message.id} gap="$1">
                <MessageRow message={message} />
                {replies.length > 0 || thinking.has(message.id) ? (
                  <Prim.Col
                    marginLeft="$4"
                    paddingLeft="$3"
                    borderLeftWidth={2}
                    borderColor="$border"
                    gap="$1"
                  >
                    {replies.map((reply) => (
                      <MessageRow key={reply.id} message={reply} />
                    ))}
                    {thinking.has(message.id) ? (
                      <Prim.Text fontSize="$xs" color="$muted-foreground">
                        THING is thinking…
                      </Prim.Text>
                    ) : null}
                  </Prim.Col>
                ) : null}
                <Prim.Pressable
                  onClick={() => setThread(thread === message.id ? null : message.id)}
                >
                  <Prim.Text fontSize="$xs" color="$muted-foreground">
                    {thread === message.id ? 'replying in thread — cancel' : 'reply in thread'}
                  </Prim.Text>
                </Prim.Pressable>
              </Prim.Col>
            )
          })}
        </Prim.Col>

        <Prim.Row
          gap="$2"
          padding="$3"
          borderTopWidth={1}
          borderColor="$border"
          alignItems="center"
        >
          <Prim.TextField
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              thread ? 'Reply in thread… (@thing to ask THING)' : 'Message… (@thing to ask THING)'
            }
            flex={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <Prim.Pressable
            onClick={() => void send()}
            disabled={!draft.trim()}
            paddingHorizontal="$3"
            paddingVertical="$2"
            borderRadius="$md"
            backgroundColor="$primary"
            opacity={draft.trim() ? 1 : 0.5}
          >
            <Prim.Text color="$primary-foreground" fontSize="$sm">
              Send
            </Prim.Text>
          </Prim.Pressable>
        </Prim.Row>
      </Prim.Col>
    </Prim.Row>
  )
}

function MessageRow({ message }: { message: ChannelMessage }) {
  const who =
    message.kind === 'thing' ? 'THING' : message.kind === 'system' ? 'system' : message.email
  return (
    <Prim.Box>
      <Prim.Text
        fontSize="$xs"
        color={message.kind === 'thing' ? '$primary' : '$muted-foreground'}
      >
        {who}
      </Prim.Text>
      <Prim.Text fontSize="$sm" whiteSpace="pre-wrap">
        {message.text}
      </Prim.Text>
    </Prim.Box>
  )
}

export const Route = createFileRoute('/team/$teamId/channels')({
  component: ChannelsPage,
})

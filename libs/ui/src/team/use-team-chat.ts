/**
 * The team chat surface's state: channels, categories, the directory, the
 * transcript of the channel on screen, and the one socket that keeps all of it
 * live.
 *
 * One hook rather than a store because every piece of it is scoped to a mounted
 * channels page and dies with it — there is no second reader, and a store would
 * only add a lifetime to get wrong. The socket is the reason it is a hook at
 * all: the pod broadcasts every event a member is entitled to on one connection,
 * so every list here is updated from the same place and none of them poll.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TeamClient } from './client'
import type {
  Category,
  Channel,
  ChannelEvent,
  ChannelMessage,
  ChannelUnread,
  Directory,
  MemberProfile,
} from './types'

/** How long a `typing` event is believed without a follow-up (the server has
 * no explicit "stopped typing" event — it just stops sending). */
const TYPING_TTL_MS = 4000

/** At most one typing frame per this long, however fast someone types. */
const TYPING_THROTTLE_MS = 2500

/**
 * How long "THING is working…" is believed with no follow-up frame.
 *
 * The server only clears `thinking`/`activity` by sending an explicit terminal `thing_status` — if
 * the pod dies mid-turn (crash, restart, evicted) that frame never arrives, and without this the
 * indicator hangs on screen for the rest of the session. Reset on every `running` frame, so a long
 * but still-alive turn is never cut off early; it only fires when nothing has been heard for this
 * long.
 */
const THING_STATUS_TTL_MS = 90_000

/** The channel socket's own health, surfaced so the view can tell a member their connection
 *  dropped rather than leaving them wondering why nothing arrives any more. */
export type ConnectionState = 'connecting' | 'open' | 'reconnecting'

export interface TeamChat {
  channels: Channel[]
  categories: Category[]
  directory: Directory
  /** The caller's own directory row, once it has loaded. */
  me: MemberProfile | null
  /**
   * The caller's user id AS THE POD SEES IT.
   *
   * Not `useAuth().session.userId`: that is who the GATEWAY thinks you are, and
   * everything this surface compares it against — a message's `userId`, a DM's
   * `members` — was stamped by the pod from the team token's own claim. Asking
   * the pod who is calling makes the two sides of every comparison come from the
   * same place. Empty until the first profile read lands.
   */
  meId: string
  messages: ChannelMessage[]
  /** True while the active channel's history is in flight — `messages` is stale (the previous
   *  channel's, or empty) and should not be read as "this channel has nothing in it yet". */
  loading: boolean
  /** Whether the pod has more history before the oldest message currently loaded — the server's
   *  own `hasMore`, carried through rather than guessed from a page length. */
  hasMore: boolean
  /** True while a `loadOlder` fetch is in flight, so the affordance can say so and not be tapped
   *  twice into two overlapping requests. */
  loadingOlder: boolean
  /**
   * Fetch the page immediately before the oldest message currently loaded, and prepend it.
   *
   * A no-op with nothing to page from (no active channel, no messages yet) or while a fetch is
   * already running. Safe to call again after the channel has changed mid-flight: the result is
   * discarded rather than spliced into whatever is on screen by then.
   */
  loadOlder: () => Promise<void>
  /** The channel socket's health. `reconnecting` is distinct from the initial `connecting`: it
   *  means the surface WAS live and dropped, which is the case worth telling a member about. */
  connection: ConnectionState
  error: string | null
  /** Thread root ids THING is currently working in. */
  thinking: Set<string>
  /** threadId → THING's live `setActivity()` text, while it is running. A long
   *  turn is otherwise a blank wait a reader cannot tell apart from a hang. */
  activity: Map<string, string>
  /** Display labels of members typing in the channel on screen. */
  typingHere: string[]
  /** channelId → what is waiting there for this member. */
  unread: Map<string, ChannelUnread>
  /** Mentions across every channel — what the browser tab's badge counts. */
  totalMentions: number
  send: (text: string, threadId?: string) => Promise<void>
  createChannel: (name: string, categoryId?: string) => Promise<Channel | null>
  createCategory: (name: string) => Promise<void>
  deleteCategory: (categoryId: string) => Promise<void>
  patchChannel: (channelId: string, patch: { name?: string; categoryId?: string | null; apps?: string[] }) => Promise<void>
  openDm: (userId: string) => Promise<Channel | null>
  setProfile: (patch: { handle?: string | null; displayName?: string | null }) => Promise<void>
  /** Tell the pod this member is typing here. Throttled; safe to call per keystroke. */
  notifyTyping: (channelId: string) => void
  dismissError: () => void
}

/**
 * @param activeId The channel on screen, owned by the CALLER (it lives in the URL).
 *   Deliberately not state in here: with a copy on both sides, opening a direct
 *   message set the hook's copy while the URL kept the old one, and the sidebar
 *   highlighted a conversation the transcript never switched to.
 */
export function useTeamChat(client: TeamClient, activeId: string | null): TeamChat {
  const [channels, setChannels] = useState<Channel[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [directory, setDirectory] = useState<Directory>({ members: [], projects: [] })
  const [me, setMe] = useState<MemberProfile | null>(null)
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  // The channel `messages` currently holds history FOR, once the fetch below has settled
  // (success or failure). Compared against `activeId` to derive `loading` below — a plain
  // boolean flip in the effect would still leave one render where `activeId` has already moved
  // on but the flag has not caught up yet, which is exactly the flash this exists to remove.
  const [historyChannelId, setHistoryChannelId] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [thinking, setThinking] = useState<Set<string>>(new Set())
  const [activity, setActivity] = useState<Map<string, string>>(new Map())
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map())
  const [unread, setUnread] = useState<Map<string, ChannelUnread>>(new Map())

  // The socket handler closes over these, and it is installed ONCE — rebuilding
  // it on every channel switch would drop and remake the connection, losing
  // whatever arrived in between.
  const activeIdRef = useRef<string | null>(activeId)
  activeIdRef.current = activeId
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const thingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const socket = useRef<WebSocket | null>(null)
  const lastTypingSent = useRef(0)

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  // Channels + categories arrive together; the directory is a second call
  // because it is the picker's data, not the sidebar's, and a slow project scan
  // must not hold up the list of channels.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { channels: list, categories: cats, unread: badges } = await client.channels()
        if (cancelled) return
        setChannels(list)
        setCategories(cats)
        setUnread(new Map(badges.map((u) => [u.channelId, u])))
      } catch (err) {
        if (!cancelled) fail(err)
      }
    })()
    void (async () => {
      try {
        const dir = await client.directory()
        if (!cancelled) setDirectory(dir)
      } catch {
        // The picker degrades to THING-only; the surface still works.
      }
    })()
    // Who the pod thinks is calling. The read also REGISTERS the caller in the
    // directory, so opening the surface is what puts you in everyone's DM list.
    void (async () => {
      try {
        const { profile } = await client.profile()
        if (!cancelled) setMe(profile)
      } catch {
        // Without it, `meId` stays empty: nothing is "mine", which renders a
        // correct-if-impersonal surface rather than a wrong one.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, fail])

  // History for the selected channel — and, having shown it, tell the pod it has
  // been read. Opening a channel IS reading it; a separate "mark as read" would
  // be an extra thing to do for something the member has already done.
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setMessages([])
    setHasMore(false)
    void (async () => {
      try {
        const { messages: history, hasMore: more } = await client.messages(activeId)
        if (cancelled) return
        setMessages(history)
        setHasMore(more)
        setUnread((prev) => {
          if (!prev.get(activeId)?.hasUnread && !prev.get(activeId)?.mentions) return prev
          const next = new Map(prev)
          next.set(activeId, { channelId: activeId, hasUnread: false, mentions: 0 })
          return next
        })
        // Not awaited into the render path: the badge is already down locally,
        // and this only has to reach the pod before the next device asks.
        void client.markRead(activeId).catch(() => {})
      } catch (err) {
        if (!cancelled) fail(err)
      } finally {
        // Settled either way. On failure `messages` stays empty, but `loading` must still drop —
        // otherwise the error banner (already rendered from `error` above) sits behind a
        // "loading" state that never resolves.
        if (!cancelled) setHistoryChannelId(activeId)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeId, client, fail])

  // One socket for the whole surface. The pod sends a member only what they are
  // entitled to (a DM never reaches a non-participant's socket at all), so
  // everything that arrives here can be trusted into state.
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false

    // Declared before it is attached: the URL is now awaited (the token comes
    // from the transport), so the connect is async and must not close over a
    // handler that is still in its temporal dead zone.
    const onFrame = (event: { data: unknown }) => {
      let parsed: ChannelEvent
      try {
        parsed = JSON.parse(String(event.data)) as ChannelEvent
      } catch {
        return
      }
      if (parsed.type === 'message') {
        const incoming = parsed.message
        setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]))
        // Raise the badge locally rather than re-fetching the channel list on
        // every message. The channel on screen is exempt — it is being read as it
        // arrives, and `markRead` below tells the pod so.
        setUnread((prev) => {
          if (incoming.channelId === activeIdRef.current || incoming.userId === meIdRef.current) return prev
          const current = prev.get(incoming.channelId)
          const namesMe = !!meIdRef.current && incoming.mentions?.includes(meIdRef.current)
          const next = new Map(prev)
          next.set(incoming.channelId, {
            channelId: incoming.channelId,
            hasUnread: true,
            mentions: (current?.mentions ?? 0) + (namesMe ? 1 : 0),
          })
          return next
        })
        // Somebody who just spoke is no longer typing.
        setTypingUsers((prev) => {
          if (!incoming.userId || !prev.has(incoming.userId)) return prev
          const next = new Map(prev)
          next.delete(incoming.userId)
          return next
        })
      } else if (parsed.type === 'thing_status') {
        const threadId = parsed.threadId
        setThinking((prev) => {
          const next = new Set(prev)
          if (parsed.status === 'running') next.add(threadId)
          else next.delete(threadId)
          return next
        })
        setActivity((prev) => {
          const next = new Map(prev)
          // Cleared on done/error as well as when a running frame carries no
          // label, so a finished turn never leaves its last step on screen.
          if (parsed.status === 'running' && parsed.activity) next.set(threadId, parsed.activity)
          else next.delete(threadId)
          return next
        })
        // Safety valve for a pod that dies mid-turn: it never gets to send the terminal frame
        // that would otherwise clear `thinking`/`activity`, and without this "THING is working…"
        // is on screen for good. Reset on every `running` frame, so a long but still-alive turn
        // is never cut off — only silence for `THING_STATUS_TTL_MS` closes it out.
        const existingThing = thingTimers.current.get(threadId)
        if (existingThing) clearTimeout(existingThing)
        if (parsed.status === 'running') {
          thingTimers.current.set(
            threadId,
            setTimeout(() => {
              setThinking((prev) => {
                if (!prev.has(threadId)) return prev
                const next = new Set(prev)
                next.delete(threadId)
                return next
              })
              setActivity((prev) => {
                if (!prev.has(threadId)) return prev
                const next = new Map(prev)
                next.delete(threadId)
                return next
              })
              thingTimers.current.delete(threadId)
            }, THING_STATUS_TTL_MS),
          )
        } else {
          thingTimers.current.delete(threadId)
        }
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
      } else if (parsed.type === 'channel') {
        const incoming = parsed.channel
        setChannels((prev) => {
          const at = prev.findIndex((c) => c.id === incoming.id)
          if (at < 0) return [...prev, incoming]
          const next = [...prev]
          next[at] = incoming
          return next
        })
      } else if (parsed.type === 'categories') {
        setCategories(parsed.categories)
      }
    }
    // Reconnect with a capped exponential backoff — mirrors `chat/store/ws-client.ts`, which the
    // trace socket already solved this for. Without it, any network blip, laptop sleep or pod
    // restart left messages/typing/`thing_status` silently dead until a full page reload; on the
    // mobile shell the team screen stays mounted-but-hidden behind other tabs specifically so
    // this socket survives switching away, which only pays off if the socket can heal itself.
    let backoff = 500
    let everConnected = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      setConnection(everConnected ? 'reconnecting' : 'connecting')
      void (async () => {
        const url = await client.socketUrl()
        if (closed) return
        let next: WebSocket
        try {
          next = new WebSocket(url)
        } catch {
          reconnectTimer = setTimeout(connect, (backoff = Math.min(backoff * 2, 8000)))
          return
        }
        ws = next
        socket.current = next
        next.onmessage = onFrame
        next.onopen = () => {
          backoff = 500
          everConnected = true
          setConnection('open')
        }
        next.onclose = () => {
          if (socket.current === next) socket.current = null
          if (closed) return
          setConnection(everConnected ? 'reconnecting' : 'connecting')
          reconnectTimer = setTimeout(connect, (backoff = Math.min(backoff * 2, 8000)))
        }
        // No handler of its own: `onclose` always follows `onerror` for a WebSocket, and that is
        // where the retry is scheduled — a second schedule here would just double it up.
        next.onerror = () => {}
      })()
    }
    connect()

    const timers = typingTimers.current
    const thingTimersMap = thingTimers.current
    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      socket.current = null
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
      thingTimersMap.forEach((t) => clearTimeout(t))
      thingTimersMap.clear()
    }
  }, [client])

  const send = useCallback(
    async (text: string, threadId?: string) => {
      if (!activeId) return
      try {
        const { message } = await client.postMessage(activeId, text, threadId)
        // Appended from the REST response rather than waiting for the socket to echo it back —
        // on a slow or dropped connection that echo might never arrive, and the sender would
        // never see their own message land. The socket handler above dedupes on `id`, so the
        // later echo (if it comes) is a no-op against this.
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
      } catch (err) {
        // Surfaced through the same `error` the rest of this hook uses, so a failed send is a
        // visible banner rather than a draft that silently reappeared in the composer. Rethrown
        // so the composer's own catch still restores what was typed.
        fail(err)
        throw err
      }
    },
    [activeId, client, fail],
  )

  const loadOlder = useCallback(async () => {
    const forId = activeIdRef.current
    if (!forId || loadingOlder) return
    // The oldest message CURRENTLY LOADED for this channel — the pod pages backwards from an id
    // already on screen, not from a timestamp the client would have to reconstruct. `messages`
    // can hold stray arrivals for OTHER channels too (the socket handler appends regardless of
    // which channel is active), so this filters rather than reading `messages[0]` directly.
    const oldest = messages.find((m) => m.channelId === forId)?.id
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const { messages: older, hasMore: more } = await client.messages(forId, { before: oldest })
      // The channel on screen moved on while this was in flight — the channel-switch effect has
      // already reset `messages`/`hasMore` for wherever the member is now, and splicing a stale
      // page in on top of that would show them someone else's history.
      if (activeIdRef.current !== forId) return
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        const fresh = older.filter((m) => !known.has(m.id))
        return [...fresh, ...prev]
      })
      setHasMore(more)
    } catch (err) {
      if (activeIdRef.current === forId) fail(err)
    } finally {
      setLoadingOlder(false)
    }
  }, [messages, client, fail, loadingOlder])

  const createChannel = useCallback(
    async (name: string, categoryId?: string) => {
      try {
        const { channel } = await client.createChannel(name, categoryId)
        // The socket delivers it too; adding it here means the creator's own
        // click is not waiting on a round trip through the hub.
        setChannels((prev) => (prev.some((c) => c.id === channel.id) ? prev : [...prev, channel]))
        return channel
      } catch (err) {
        fail(err)
        return null
      }
    },
    [client, fail],
  )

  const createCategory = useCallback(
    async (name: string) => {
      try {
        const { category } = await client.createCategory(name)
        setCategories((prev) => (prev.some((c) => c.id === category.id) ? prev : [...prev, category]))
      } catch (err) {
        fail(err)
      }
    },
    [client, fail],
  )

  const deleteCategory = useCallback(
    async (categoryId: string) => {
      try {
        await client.deleteCategory(categoryId)
        setCategories((prev) => prev.filter((c) => c.id !== categoryId))
        setChannels((prev) =>
          prev.map((c) => (c.categoryId === categoryId ? { ...c, categoryId: undefined } : c)),
        )
      } catch (err) {
        fail(err)
      }
    },
    [client, fail],
  )

  const patchChannel = useCallback<TeamChat['patchChannel']>(
    async (channelId, patch) => {
      try {
        const { channel } = await client.patchChannel(channelId, patch)
        setChannels((prev) => prev.map((c) => (c.id === channel.id ? channel : c)))
      } catch (err) {
        fail(err)
      }
    },
    [client, fail],
  )

  const openDm = useCallback(
    async (userId: string) => {
      try {
        const { channel } = await client.openDm(userId)
        setChannels((prev) => (prev.some((c) => c.id === channel.id) ? prev : [...prev, channel]))
        return channel
      } catch (err) {
        fail(err)
        return null
      }
    },
    [client, fail],
  )

  const setProfile = useCallback<TeamChat['setProfile']>(
    async (patch) => {
      const { profile } = await client.setProfile(patch)
      setMe(profile)
      setDirectory((prev) => ({
        ...prev,
        members: prev.members.some((m) => m.userId === profile.userId)
          ? prev.members.map((m) => (m.userId === profile.userId ? profile : m))
          : [...prev.members, profile],
      }))
    },
    [client],
  )

  const notifyTyping = useCallback((channelId: string) => {
    const ws = socket.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const now = Date.now()
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return
    lastTypingSent.current = now
    try {
      ws.send(JSON.stringify({ type: 'typing', channelId }))
    } catch {
      /* a dropped typing frame is a missing hint, not an error */
    }
  }, [])

  const meId = me?.userId ?? ''
  const meIdRef = useRef(meId)
  meIdRef.current = meId

  const visible = useMemo(
    () => messages.filter((m) => m.channelId === activeId),
    [messages, activeId],
  )

  // Name whoever is typing using the same directory the rest of the surface
  // reads, falling back to the email their last message carried.
  const typingHere = useMemo(() => {
    const byId = new Map(directory.members.map((m) => [m.userId, m]))
    const emailById = new Map<string, string>()
    for (const m of visible) if (m.userId && m.email) emailById.set(m.userId, m.email)
    return [...typingUsers.entries()]
      .filter(([userId, channelId]) => channelId === activeId && userId !== meId)
      .map(([userId]) => {
        const member = byId.get(userId)
        return member?.displayName || (member?.handle ? `@${member.handle}` : '') || emailById.get(userId) || 'Someone'
      })
  }, [typingUsers, activeId, directory.members, visible, meId])

  return {
    channels,
    categories,
    directory,
    me,
    meId,
    messages: visible,
    // `null` activeId means there is nothing to load rather than something in flight.
    loading: activeId !== null && historyChannelId !== activeId,
    hasMore,
    loadingOlder,
    loadOlder,
    connection,
    error,
    thinking,
    activity,
    typingHere,
    unread,
    totalMentions: [...unread.values()].reduce((sum, u) => sum + u.mentions, 0),
    send,
    createChannel,
    createCategory,
    deleteCategory,
    patchChannel,
    openDm,
    setProfile,
    notifyTyping,
    dismissError: () => setError(null),
  }
}

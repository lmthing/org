/**
 * Regression tests for the three highest-risk fixes in this hook — the ones where a bug sends a
 * message into the wrong channel, loses one outright, or flashes a wrong "nothing here yet".
 *
 * jsdom, no Tamagui provider needed: `useTeamChat` renders no JSX of its own.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamChat } from './use-team-chat'
import type { TeamClient } from './client'
import type { Channel, ChannelMessage, Directory, MemberProfile } from './types'

/** A minimal, fully-stubbed `TeamClient` — every test overrides only what it needs. */
function makeClient(overrides: Partial<TeamClient> = {}): TeamClient {
  return {
    channels: vi.fn().mockResolvedValue({ channels: [], categories: [], unread: [] }),
    createChannel: vi.fn().mockResolvedValue({ channel: {} as Channel, created: true }),
    patchChannel: vi.fn().mockResolvedValue({ channel: {} as Channel }),
    messages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    postMessage: vi.fn(),
    markRead: vi.fn().mockResolvedValue({ ok: true }),
    openDm: vi.fn().mockResolvedValue({ channel: {} as Channel, created: true }),
    createCategory: vi.fn().mockResolvedValue({ category: { id: 'c', name: 'c', order: 0 }, created: true }),
    deleteCategory: vi.fn().mockResolvedValue({ deleted: 'c' }),
    directory: vi.fn().mockResolvedValue({ members: [], projects: [] } satisfies Directory),
    profile: vi.fn().mockResolvedValue({ profile: null as MemberProfile | null }),
    setProfile: vi.fn(),
    socketUrl: vi.fn().mockResolvedValue('ws://pod.test/api/team/ws'),
    ...overrides,
  }
}

/** A `Promise` this test can resolve on its own schedule, to observe the `loading` state while a
 *  fetch is genuinely in flight rather than racing a real network call. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

/** Stands in for the browser `WebSocket` the socket effect constructs — inert by default, so tests
 *  that don't care about the socket never have to wait on one. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  readyState = 0
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send() {}
  close() {
    this.readyState = 3
  }
}

const originalWebSocket = globalThis.WebSocket

beforeEach(() => {
  FakeWebSocket.instances = []
  ;(globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket
})

afterEach(() => {
  ;(globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket
  vi.restoreAllMocks()
})

describe('useTeamChat — loading flag (item 1: no empty-state flash on channel switch)', () => {
  it('is true the instant the active channel changes, before the fetch for it resolves', async () => {
    const general = deferred<{ messages: ChannelMessage[]; hasMore: boolean }>()
    const random = deferred<{ messages: ChannelMessage[]; hasMore: boolean }>()
    const messagesFor = (channelId: string) => (channelId === 'general' ? general.promise : random.promise)
    const client = makeClient({ messages: vi.fn((id: string) => messagesFor(id)) })

    const { result, rerender } = renderHook(({ activeId }) => useTeamChat(client, activeId), {
      initialProps: { activeId: 'general' as string | null },
    })

    // Nothing has resolved yet — loading, and correctly so (there is nothing to show as "empty").
    expect(result.current.loading).toBe(true)

    await act(async () => {
      general.resolve({
        messages: [{ id: 'm1', ts: new Date().toISOString(), channelId: 'general', kind: 'user', text: 'hi' }],
        hasMore: false,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.messages).toHaveLength(1)

    // Switch channels. The regression this pins: `loading` must already be true on THIS render —
    // synchronously, from `activeId` no longer matching the channel `messages` was last loaded
    // for — not one render later once an effect gets around to flipping a flag. A test that only
    // checked `loading` after an `await` would miss exactly the race that caused the flash.
    rerender({ activeId: 'random' })
    expect(result.current.loading).toBe(true)
    // And nothing from #general leaks into #random's view while it settles.
    expect(result.current.messages).toHaveLength(0)

    await act(async () => {
      random.resolve({ messages: [], hasMore: false })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('never reports loading when no channel is selected', () => {
    const client = makeClient()
    const { result } = renderHook(() => useTeamChat(client, null))
    expect(result.current.loading).toBe(false)
  })

  it('drops loading on a failed fetch too, so the error banner is not stuck behind it', async () => {
    const client = makeClient({ messages: vi.fn().mockRejectedValue(new Error('pod unreachable')) })
    const { result } = renderHook(() => useTeamChat(client, 'general'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('pod unreachable')
  })
})

describe('useTeamChat — send (item 4: optimistic append + socket-echo dedupe)', () => {
  it('appends the REST response immediately, without waiting for the socket to echo it back', async () => {
    const sent: ChannelMessage = {
      id: 'srv-1',
      ts: new Date().toISOString(),
      channelId: 'general',
      kind: 'user',
      text: 'hello team',
      userId: 'me',
    }
    const client = makeClient({ postMessage: vi.fn().mockResolvedValue({ message: sent }) })
    const { result } = renderHook(() => useTeamChat(client, 'general'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.send('hello team')
    })

    expect(result.current.messages.map((m) => m.id)).toEqual(['srv-1'])
  })

  it('a later socket echo of the same message id is a no-op, not a duplicate', async () => {
    const sent: ChannelMessage = {
      id: 'srv-2',
      ts: new Date().toISOString(),
      channelId: 'general',
      kind: 'user',
      text: 'hello again',
      userId: 'me',
    }
    const client = makeClient({ postMessage: vi.fn().mockResolvedValue({ message: sent }) })
    const { result } = renderHook(() => useTeamChat(client, 'general'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.send('hello again')
      // Let the socket connect (an async `socketUrl()` await stands between mount and `ws.onmessage`
      // being wired up).
      await Promise.resolve()
      await Promise.resolve()
    })

    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'message', message: sent }) })
    })

    expect(result.current.messages).toHaveLength(1)
  })

  it('surfaces a failed send as a visible error and still rethrows so the composer restores the draft', async () => {
    const client = makeClient({ postMessage: vi.fn().mockRejectedValue(new Error('offline')) })
    const { result } = renderHook(() => useTeamChat(client, 'general'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Caught INSIDE the `act` (rather than asserting on the outer promise via `.rejects`) so the
    // `setError` that happens in the same catch block is guaranteed to have committed before this
    // test reads `result.current` — `composer.tsx`'s own catch (which restores the draft) relies
    // on exactly this rethrow, so proving both halves needs the state update to have landed too.
    let caught: unknown
    await act(async () => {
      try {
        await result.current.send('will this land?')
      } catch (err) {
        caught = err
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('offline')
    expect(result.current.error).toBe('offline')
    // Not appended optimistically — there is nothing to dedupe against, and the message never sent.
    expect(result.current.messages).toHaveLength(0)
  })
})

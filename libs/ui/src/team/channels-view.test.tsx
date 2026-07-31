/**
 * `TeamChannelsView`, end to end against an in-memory `TeamClient` — the same seam
 * `apps/web`/`apps/mobile` inject, and the one `design/team-chat-ux-progress.md` documents as
 * this surface's own screenshot gate relying on.
 *
 * Two round-2 regressions pinned here:
 *  - item 1: older history was unreachable even though the pod already pages it
 *    (`libs/cli/src/server/routes/team-channels.ts#handleListMessages`) — "Load earlier messages"
 *    now surfaces the cursor.
 *  - item 3: the compact drawer could only be closed by finding its own close button — Escape now
 *    dismisses it via the same seam `Drawer`/`Dialog` already use (`platform/keyboard#onDismiss`).
 *
 * `./use-layout` is mocked rather than exercised for real: `useTeamLayout` calls Tamagui's
 * `useMedia`, whose jsdom behaviour this suite has no reason to depend on to prove either of the
 * above — both are pure wiring questions with a known-good/known-bad answer regardless of which
 * breakpoint the test happens to compute to.
 */
import * as React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor } from '../test-utils/index'
import { TeamChannelsView } from './channels-view'
import { useTeamLayout } from './use-layout'
import type { TeamClient } from './client'
import type { Category, Channel, ChannelMessage, Directory, MemberProfile } from './types'

vi.mock('./use-layout', () => ({ useTeamLayout: vi.fn() }))

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
  vi.mocked(useTeamLayout).mockReturnValue({ compact: false, phone: false })
})
afterEach(() => {
  ;(globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket
  vi.restoreAllMocks()
})

function makeClient(overrides: Partial<TeamClient> = {}): TeamClient {
  return {
    channels: vi.fn().mockResolvedValue({
      channels: [{ id: 'general', name: 'general', createdBy: 'system', createdAt: '' }] satisfies Channel[],
      categories: [] satisfies Category[],
      unread: [],
    }),
    createChannel: vi.fn(),
    patchChannel: vi.fn(),
    messages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    postMessage: vi.fn(),
    markRead: vi.fn().mockResolvedValue({ ok: true }),
    openDm: vi.fn(),
    createCategory: vi.fn(),
    deleteCategory: vi.fn(),
    directory: vi.fn().mockResolvedValue({ members: [], projects: [] } satisfies Directory),
    profile: vi.fn().mockResolvedValue({ profile: { userId: 'u-me', joinedAt: '', updatedAt: '' } as MemberProfile }),
    setProfile: vi.fn(),
    socketUrl: vi.fn().mockResolvedValue('ws://pod.test/api/team/ws'),
    uploadAttachment: vi.fn(),
    attachmentUrl: vi.fn((url: string) => url),
    ...overrides,
  }
}

const BASE_PROPS = {
  isEditor: false,
  activeChannelId: 'general',
  rail: null,
  onSelectChannel: () => {},
  onOpenThread: () => {},
  onOpenApp: () => {},
  onCloseRail: () => {},
  appUrl: () => '',
}

describe('TeamChannelsView — Load earlier messages (round 2, item 1)', () => {
  it('surfaces the pod\'s hasMore, pages backwards from the oldest loaded id, and hides once exhausted', async () => {
    const oldMsg: ChannelMessage = {
      id: 'm4', ts: '2026-01-01T00:04:00.000Z', channelId: 'general', kind: 'user', text: 'the older message',
    }
    const newMsg: ChannelMessage = {
      id: 'm5', ts: '2026-01-01T00:05:00.000Z', channelId: 'general', kind: 'user', text: 'the newer message',
    }
    const messagesFn = vi.fn((channelId: string, opts?: { before?: string }) =>
      opts?.before === 'm5'
        ? Promise.resolve({ messages: [oldMsg], hasMore: false })
        : Promise.resolve({ messages: [newMsg], hasMore: true }),
    )
    const client = makeClient({ messages: messagesFn })
    const { findByText, getByText, queryByText } = render(
      <TeamChannelsView {...BASE_PROPS} client={client} />,
    )

    await findByText('the newer message')
    const button = await findByText('Load earlier messages')

    fireEvent.click(button)

    await findByText('the older message')
    expect(messagesFn).toHaveBeenCalledWith('general', { before: 'm5' })
    // Both messages now on screen, oldest first.
    expect(getByText('the older message')).toBeTruthy()
    expect(getByText('the newer message')).toBeTruthy()
    // The pod said there is nothing further back — the affordance goes away rather than offering
    // a fetch that can only come back empty.
    await waitFor(() => expect(queryByText('Load earlier messages')).toBeNull())
  })

  it('is absent when the pod reports no more history', async () => {
    const client = makeClient({
      messages: vi.fn().mockResolvedValue({
        messages: [{ id: 'm1', ts: new Date().toISOString(), channelId: 'general', kind: 'user', text: 'only message' }],
        hasMore: false,
      }),
    })
    const { findByText, queryByText } = render(<TeamChannelsView {...BASE_PROPS} client={client} />)
    await findByText('only message')
    expect(queryByText('Load earlier messages')).toBeNull()
  })
})

describe('TeamChannelsView — the compact drawer dismisses on Escape (round 2, item 3)', () => {
  it('closes the channel drawer on Escape, the same seam Drawer/Dialog already use', async () => {
    vi.mocked(useTeamLayout).mockReturnValue({ compact: true, phone: true })
    const client = makeClient()
    // `SidebarHeader` (and its "Close channels" button) renders nothing at all without a `team` —
    // it is the one piece of chrome both targets have, so a caller always supplies it in practice.
    const { container, findByLabelText } = render(
      <TeamChannelsView {...BASE_PROPS} client={client} team={{ id: 't1', name: 'Test Team' }} />,
    )

    // Open the drawer — the only way to reach the sidebar in compact layout.
    fireEvent.click(await findByLabelText('Channels'))
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Close channels"]')).toBeTruthy(),
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() =>
      expect(container.querySelector('[aria-label="Close channels"]')).toBeNull(),
    )
  })
})

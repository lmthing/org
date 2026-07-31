/**
 * Round 2, item 2: the DM list had no ordering — it drew `directory().members` in whatever order
 * the API happened to return them, while a named channel already got bold/mention treatment
 * (`MentionBadge`). This pins the ranking `ChannelSidebar` now applies: mentions first, then
 * anything unread, then an existing (read) conversation, then someone never messaged — each tier
 * alphabetical inside itself so two people in the same tier do not jitter between renders.
 */
import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '../test-utils/index'
import { ChannelSidebar, type SidebarProps } from './sidebar'
import type { Channel, ChannelUnread, MemberProfile } from './types'

const MEMBERS: MemberProfile[] = [
  { userId: 'u-ana', email: 'ana@example.com', handle: 'ana', displayName: 'Ana', joinedAt: '', updatedAt: '' },
  { userId: 'u-bo', email: 'bo@example.com', handle: 'bo', displayName: 'Bo', joinedAt: '', updatedAt: '' },
  { userId: 'u-cy', email: 'cy@example.com', handle: 'cy', displayName: 'Cy', joinedAt: '', updatedAt: '' },
  { userId: 'u-di', email: 'di@example.com', handle: 'di', displayName: 'Di', joinedAt: '', updatedAt: '' },
  { userId: 'u-me', email: 'me@example.com', handle: 'me', displayName: 'Me', joinedAt: '', updatedAt: '' },
]

/** Ana: mentioned. Bo: unread, no mention. Cy: an existing, fully-read conversation.
 *  Di: never messaged at all — no channel for them below. Listed here in the WRONG order on
 *  purpose — the point is that the component reorders them, not that the fixture happens to
 *  agree. */
const DMS: Channel[] = [
  { id: 'dm-cy', name: 'dm', createdBy: 'u-me', createdAt: '', kind: 'dm', members: ['u-me', 'u-cy'] },
  { id: 'dm-bo', name: 'dm', createdBy: 'u-me', createdAt: '', kind: 'dm', members: ['u-me', 'u-bo'] },
  { id: 'dm-ana', name: 'dm', createdBy: 'u-me', createdAt: '', kind: 'dm', members: ['u-me', 'u-ana'] },
]

const UNREAD = new Map<string, ChannelUnread>([
  ['dm-ana', { channelId: 'dm-ana', hasUnread: true, mentions: 2 }],
  ['dm-bo', { channelId: 'dm-bo', hasUnread: true, mentions: 0 }],
  // dm-cy: no entry at all — read, same as a channel nobody has ever badged.
])

const BASE_PROPS: SidebarProps = {
  channels: DMS,
  categories: [],
  members: MEMBERS,
  meId: 'u-me',
  activeId: null,
  isEditor: false,
  unread: UNREAD,
  onSelect: () => {},
  onCreateChannel: () => {},
  onCreateCategory: () => {},
  onDeleteCategory: () => {},
  onMoveChannel: () => {},
  onOpenDm: () => {},
}

/**
 * The DM rows' labels, top to bottom, as rendered — `querySelectorAll('*')` walks the tree in
 * DOCUMENT order, which for a plain (non-absolutely-positioned) list is reading order. Matched by
 * EXACT textContent so a member's mention-badge sibling (e.g. Ana's "2") does not fold into an
 * ancestor's text and produce "Ana2" — only the innermost element holding just the name matches.
 */
function dmOrder(container: HTMLElement, names: string[]): string[] {
  const all = [...container.querySelectorAll('*')]
  return names
    .map((name) => {
      const index = all.findIndex((n) => n.textContent === name)
      return index < 0 ? null : { name, index }
    })
    .filter((x): x is { name: string; index: number } => x !== null)
    .sort((a, b) => a.index - b.index)
    .map((p) => p.name)
}

describe('ChannelSidebar — direct-message ordering (round 2, item 2)', () => {
  it('ranks mentions, then unread, then an existing conversation, then nobody-messaged-yet', () => {
    const { container } = render(<ChannelSidebar {...BASE_PROPS} />)
    expect(dmOrder(container, ['Ana', 'Bo', 'Cy', 'Di'])).toEqual(['Ana', 'Bo', 'Cy', 'Di'])
  })

  it('breaks a tie within a tier alphabetically, not by directory order', () => {
    // Two more members in the SAME tier (never messaged) as Di, deliberately listed after it —
    // if the sort were doing nothing this would still read Di, Zed, Al in directory order.
    const members = [
      ...MEMBERS,
      { userId: 'u-zed', email: 'zed@example.com', handle: 'zed', displayName: 'Zed', joinedAt: '', updatedAt: '' },
      { userId: 'u-al', email: 'al@example.com', handle: 'al', displayName: 'Al', joinedAt: '', updatedAt: '' },
    ]
    const { container } = render(<ChannelSidebar {...BASE_PROPS} members={members} />)
    const order = dmOrder(container, ['Ana', 'Bo', 'Cy', 'Di', 'Zed', 'Al'])
    const tailTier = order.filter((n) => ['Di', 'Zed', 'Al'].includes(n))
    expect(tailTier).toEqual(['Al', 'Di', 'Zed'])
  })
})

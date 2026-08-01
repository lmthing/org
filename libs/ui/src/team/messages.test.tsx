/**
 * Round 2, item 4: `MessageActions` offered only "Reply in thread" — a long message had no way
 * to be copied. Editing/deleting are deliberately NOT here: the pod has no endpoint for either
 * (`sdk/org/libs/cli/src/server/routes/team-channels.ts` has no PATCH/DELETE on a message).
 */
import * as React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, waitFor } from '../test-utils/index'
import { MessageRow } from './messages'
import type { ChannelMessage, MemberProfile } from './types'

vi.mock('../platform/clipboard', () => ({
  clipboard: {
    writeText: vi.fn().mockResolvedValue(true),
    readText: vi.fn().mockResolvedValue(''),
  },
}))
// This import deliberately follows the `vi.mock` above — the mock has to be registered before the
// module under test pulls it in. (No `import/order` disable: `eslint-plugin-import` is not a
// dependency, so that rule never ran and naming it was itself an error.)
import { clipboard } from '../platform/clipboard'

const MEMBERS: MemberProfile[] = [
  { userId: 'u-ana', email: 'ana@example.com', handle: 'ana', displayName: 'Ana', joinedAt: '', updatedAt: '' },
]
const CTX = { members: MEMBERS, appProjects: new Set<string>(), onOpenApp: () => {} }

const message = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: 'm1',
  ts: new Date().toISOString(),
  channelId: 'general',
  kind: 'user',
  text: 'This is the exact text a colleague should be able to copy verbatim.',
  userId: 'u-ana',
  email: 'ana@example.com',
  ...over,
})

afterEach(() => {
  vi.mocked(clipboard.writeText).mockClear()
})

describe('MessageActions — copy (round 2, item 4)', () => {
  it('puts the message text on the clipboard when Copy is clicked, on a message that can also be replied to', async () => {
    const msg = message()
    const { container, getByText } = render(
      <MessageRow message={msg} showHeader={true} ctx={CTX} onReply={() => {}} />,
    )
    // Revealed by hover, same as "Reply in thread" always was.
    // `container.firstChild` is a Tamagui `<span>` wrapper (the theme/provider chrome the test
    // render helper adds), not the actual element the handler is on — `mouseEnter` does not bubble
    // down from an ancestor the way `fireEvent` dispatches it, so this has to target the real host
    // element. It is the first `<div>` in the tree: every node above it is one of Tamagui's `<span
    // style="display:contents">` wrappers.
    fireEvent.mouseEnter(container.querySelector('div') as Element)
    fireEvent.click(getByText('Copy'))

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(msg.text))
    // Feedback that the click actually did something, not just silence.
    expect(getByText('Copied')).toBeTruthy()
  })

  it('is offered even where there is nothing to reply to — a thread\'s own root has no onReply', async () => {
    const msg = message({ text: 'a thread root, with no onReply wired at all' })
    const { container, getByText, queryByText } = render(
      <MessageRow message={msg} showHeader={true} ctx={CTX} />,
    )
    // `container.firstChild` is a Tamagui `<span>` wrapper (the theme/provider chrome the test
    // render helper adds), not the actual element the handler is on — `mouseEnter` does not bubble
    // down from an ancestor the way `fireEvent` dispatches it, so this has to target the real host
    // element. It is the first `<div>` in the tree: every node above it is one of Tamagui's `<span
    // style="display:contents">` wrappers.
    fireEvent.mouseEnter(container.querySelector('div') as Element)
    // No reply offered here — the whole point of `MessageRow` with no `onReply`.
    expect(queryByText('Reply in thread')).toBeNull()
    fireEvent.click(getByText('Copy'))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(msg.text))
  })

  it('does not offer any action on a system message — there is nothing to copy or reply to', () => {
    // `SystemMessage` never routes through `MessageActions` at all (`MessageRow` returns it early),
    // so there is no hover target to reveal a toolbar from — proving the toolbar never exists in
    // the tree is the whole test.
    const msg = message({ kind: 'system', text: 'Ana created #roadmap' })
    const { container } = render(<MessageRow message={msg} showHeader={true} ctx={CTX} onReply={() => {}} />)
    expect(container.textContent).not.toContain('Copy')
  })
})

describe('a revealed toolbar can be dismissed', () => {
  // Round 2 changed long-press from "reply immediately" to "reveal a toolbar", which is the right
  // mobile idiom — it is how Copy gets a gesture at all. But nothing closed it again on a touch
  // device: `onMouseLeave` is the web's answer and is inert there, so the first long-press left a
  // toolbar on screen for the rest of the session, on every message ever pressed.
  it('closes after Copy, but only once "Copied" has been seen', async () => {
    vi.useFakeTimers()
    try {
      const { container, getByText, queryByText } = render(
        <MessageRow message={message()} showHeader={true} ctx={CTX} onReply={() => {}} />,
      )
      fireEvent.mouseEnter(container.querySelector('div') as Element)
      fireEvent.click(getByText('Copy'))
      // Closing on the click itself would take the action's only feedback away with it.
      await vi.advanceTimersByTimeAsync(0)
      expect(getByText('Copied')).toBeTruthy()
      await vi.advanceTimersByTimeAsync(1500)
      expect(queryByText('Copied')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes on Escape — the seam the rail and the drawer already use', async () => {
    const { container, getByText, queryByText } = render(
      <MessageRow message={message()} showHeader={true} ctx={CTX} onReply={() => {}} />,
    )
    fireEvent.mouseEnter(container.querySelector('div') as Element)
    expect(getByText('Copy')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(queryByText('Copy')).toBeNull())
  })
})

describe('MessageBody — attachments', () => {
  it('draws an image attachment as an <img>, resolved through ctx.resolveUrl', () => {
    const ctx = { ...CTX, resolveUrl: (url: string) => `${url}?access_token=t` }
    const msg = message({
      text: 'a screenshot of the bug',
      attachments: [{ id: 'a1', kind: 'image', url: '/api/uploads/a1', mediaType: 'image/png', filename: 'bug.png' }],
    })
    const { container } = render(<MessageRow message={msg} showHeader={true} ctx={ctx} />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/api/uploads/a1?access_token=t')
    expect(img?.getAttribute('alt')).toBe('bug.png')
  })

  it('draws a non-image attachment as a named, openable file link', () => {
    const msg = message({
      text: '',
      attachments: [{ id: 'a2', kind: 'file', url: '/api/uploads/a2', mediaType: 'application/pdf', filename: 'spec.pdf' }],
    })
    const { getByText } = render(<MessageRow message={msg} showHeader={true} ctx={CTX} />)
    expect(getByText('spec.pdf')).toBeTruthy()
  })

  it('resolves through the bare url when ctx carries no resolveUrl at all', () => {
    // `CTX` above never sets `resolveUrl` — proving the fallback in `messages.tsx` rather than
    // pinning behaviour that only ever exercises a caller that remembered to wire it.
    const msg = message({
      text: '',
      attachments: [{ id: 'a3', kind: 'image', url: '/api/uploads/a3', mediaType: 'image/png' }],
    })
    const { container } = render(<MessageRow message={msg} showHeader={true} ctx={CTX} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/uploads/a3')
  })

  it('shows caption text AND the attachment together, not one or the other', () => {
    const msg = message({
      text: 'see attached',
      attachments: [{ id: 'a4', kind: 'file', url: '/api/uploads/a4', mediaType: 'text/plain', filename: 'notes.txt' }],
    })
    const { getByText } = render(<MessageRow message={msg} showHeader={true} ctx={CTX} />)
    expect(getByText('see attached')).toBeTruthy()
    expect(getByText('notes.txt')).toBeTruthy()
  })
})

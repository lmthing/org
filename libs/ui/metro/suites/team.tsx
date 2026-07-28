/**
 * The team channel surface — RENDERED on the React Native target.
 *
 * The graph gate proves these modules RESOLVE for native; it cannot tell whether
 * anything mounts. That gap is exactly where this surface's risk is: it was
 * written for the web first, and the two ways a web-first component dies on a
 * device are both invisible to the gate and to jsdom —
 *
 *   1. a string child sitting loose in a `View`. React Native raises "Text
 *      strings must be rendered within a <Text> component" and then DROPS the
 *      string, so a label vanishes rather than erroring;
 *   2. an icon that renders a DOM `<svg>`, which mounts nothing at all.
 *
 * So every case here mounts the real component through the real reconciler and
 * asserts on the native element tree.
 */
import * as React from 'react'
import { act } from 'react-test-renderer'
import { test, expect } from '../harness'
import { render, findAll, findByText, findTextInput, NATIVE_TEXT } from '../render'
import { ChannelSidebar } from '../../src/team/sidebar'
import { MessageRow, TypingStrip, ThreadSummary } from '../../src/team/messages'
import { Composer } from '../../src/team/composer'
import { HashIcon, SendIcon } from '../../src/team/icons'
import type { Category, Channel, ChannelMessage, MemberProfile } from '../../src/team/types'

/** Reproduces React Native's own check: a string may only sit under a text host. */
function looseStrings(tree: unknown): string[] {
  const out: string[] = []
  for (const node of findAll(tree as never, (type) => type !== NATIVE_TEXT)) {
    for (const child of node.children ?? []) {
      if (typeof child === 'string' && child.trim() !== '') out.push(child)
    }
  }
  return out
}

const MEMBERS: MemberProfile[] = [
  { userId: 'u-ana', email: 'ana@example.com', handle: 'ana', displayName: 'Ana Kay', joinedAt: '', updatedAt: '' },
  { userId: 'u-bo', email: 'bo@example.com', handle: 'bo', displayName: 'Bo Lin', joinedAt: '', updatedAt: '' },
]
const CATEGORIES: Category[] = [{ id: 'product', name: 'Product', order: 0 }]
const CHANNELS: Channel[] = [
  { id: 'roadmap', name: 'Roadmap', createdBy: 'u-ana', createdAt: '', kind: 'channel', categoryId: 'product' },
  { id: 'general', name: 'general', createdBy: 'system', createdAt: '' },
  { id: 'dm-x', name: 'Direct message', createdBy: 'u-ana', createdAt: '', kind: 'dm', members: ['u-ana', 'u-bo'] },
]

const SIDEBAR_PROPS = {
  channels: CHANNELS,
  categories: CATEGORIES,
  members: MEMBERS,
  meId: 'u-ana',
  activeId: 'roadmap',
  isEditor: true,
  unread: new Map([
    ['general', { channelId: 'general', hasUnread: true, mentions: 3 }],
  ]),
  onSelect: () => {},
  onCreateChannel: () => {},
  onCreateCategory: () => {},
  onDeleteCategory: () => {},
  onMoveChannel: () => {},
  onOpenDm: () => {},
}

const CTX = {
  members: MEMBERS,
  appProjects: new Set(['tracker']),
  onOpenApp: () => {},
}

const message = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: 'm1',
  ts: new Date().toISOString(),
  channelId: 'roadmap',
  kind: 'user',
  text: 'Kicking off Q3 planning',
  userId: 'u-ana',
  email: 'ana@example.com',
  ...over,
})

test('the sidebar mounts its category and channel names as real native text', () => {
  const { tree } = render(<ChannelSidebar {...SIDEBAR_PROPS} />)
  // Uppercased by a style prop, not by the string, so the node still reads "Product".
  expect(!!findByText(tree, 'Product'), 'category heading is text').toBe(true)
  expect(!!findByText(tree, 'Roadmap'), 'channel name is text').toBe(true)
  expect(!!findByText(tree, 'Bo Lin'), 'a DM is labelled by the other person').toBe(true)
})

test('the sidebar leaves no string loose in a View', () => {
  // The failure this catches drops the label silently on a device — the section
  // headers would render as naked chevrons with nothing beside them.
  const { tree } = render(<ChannelSidebar {...SIDEBAR_PROPS} />)
  expect(looseStrings(tree).join('|'), 'no loose strings').toBe('')
})

test('a mention badge mounts its count', () => {
  const { tree } = render(<ChannelSidebar {...SIDEBAR_PROPS} />)
  expect(!!findByText(tree, '3'), 'the unread mention count is drawn').toBe(true)
})

test('a message mounts its author, its time and its body', () => {
  const { tree } = render(<MessageRow message={message()} showHeader={true} ctx={CTX} />)
  expect(!!findByText(tree, 'Ana Kay'), 'author').toBe(true)
  expect(!!findByText(tree, 'just now'), 'timestamp').toBe(true)
  expect(!!findByText(tree, 'Kicking off Q3 planning'), 'body').toBe(true)
})

test('a message body with a resolving @mention still mounts every fragment as text', () => {
  // The mention path splits prose into an ARRAY of nodes, which is precisely the
  // shape that leaves bare strings under a View if it is built carelessly.
  const { tree } = render(
    <MessageRow message={message({ text: 'ping @bo about this' })} showHeader={true} ctx={CTX} />,
  )
  expect(!!findByText(tree, 'Bo Lin'), 'the mention chip resolves to a name').toBe(true)
  expect(looseStrings(tree).join('|'), 'no loose strings around the chip').toBe('')
})

test("THING's system app card mounts as an offer, not a bare sentence", () => {
  const { tree } = render(
    <MessageRow
      message={message({ kind: 'system', text: 'Standup tracker is ready.', app: { projectId: 'tracker', name: 'Standup tracker' } })}
      showHeader={true}
      ctx={CTX}
    />,
  )
  expect(!!findByText(tree, 'Standup tracker'), 'the app name').toBe(true)
  expect(!!findByText(tree, 'Open'), 'and a way to open it').toBe(true)
})

test('every @ suggestion is actually pressable on a touch device', () => {
  // The rows were wired with `onMouseDown` — correct on web, where a click would blur the textarea
  // and unmount the picker before it landed, and DROPPED by `nativeSafeProps`, which forwards no
  // DOM-only handler. So on a phone a suggestion could be seen, highlighted and tapped, and nothing
  // happened at all. Silence is the worst shape for this bug: nothing logs and nothing throws.
  const { tree, current } = render(
    <Composer
      placeholder="Message #general"
      directory={{ members: MEMBERS, projects: [] }}
      meId="u-nobody"
      onSend={() => {}}
    />,
  )
  // The picker exists only while an `@` is being typed, so drive it the way a member does.
  const input = findTextInput(tree)
  expect(!!input, 'the composer mounts a text input').toBe(true)
  act(() => {
    ;(input?.props as { onChangeText?: (t: string) => void }).onChangeText?.('@')
  })

  // The picker must actually be showing, or the rest of this asserts nothing.
  expect(!!findByText(current(), 'THING'), 'the picker offers THING').toBe(true)

  // And the node that RESPONDS must be the one holding the suggestion — the composer and its
  // wrapper respond too, so "something in this tree is pressable" would pass either way.
  const holdsThing = (n: unknown): boolean =>
    !!findByText(n as never, 'THING')
  const row = findAll(current() as never, () => true).find(
    (n) => typeof n.props?.onResponderRelease === 'function' && holdsThing(n),
  )
  expect(!!row, 'the suggestion row itself responds to touch').toBe(true)
})

test('a message with no replies shows NOTHING under it — the Slack rule', () => {
  // A permanent "Reply in thread" under every line turns a channel into a column of the same
  // offer repeated after everything anyone said. Slack reveals the action on the message you are
  // pointing at (hover on web, long-press on a phone) and spends no vertical space on it.
  const { tree } = render(<ThreadSummary replies={[]} busy={false} onOpen={() => {}} ctx={CTX} />)
  expect(tree === null, 'renders nothing at all').toBe(true)
})

test('a long press is what offers the thread on a touch device', () => {
  // There is no hover on a phone, so if the reply action were hover-only it would be unreachable
  // there — the affordance has to be carried by a gesture the target actually has.
  const { tree } = render(
    <MessageRow message={message()} showHeader={true} ctx={CTX} onReply={() => {}} />,
  )
  // Asserted through the touch RESPONDER system, which is how React Native implements a long
  // press — `onLongPress` itself never reaches the host as a prop of that name.
  const responds = (t: unknown) =>
    findAll(t as never, () => true).some((n) => n.props?.onResponderGrant !== undefined)

  expect(responds(tree), 'the message takes part in the touch responder system').toBe(true)

  const inert = render(<MessageRow message={message()} showHeader={true} ctx={CTX} />)
  expect(responds(inert.tree), 'and only where a reply is actually offered').toBe(false)
})

test('the thread summary mounts its reply count', () => {
  const { tree } = render(
    <ThreadSummary replies={[message({ id: 'r1', threadId: 'm1' })]} busy={false} onOpen={() => {}} ctx={CTX} />,
  )
  expect(!!findByText(tree, '1 reply'), 'singular reply count').toBe(true)
})

test('the typing strip mounts its sentence', () => {
  const { tree } = render(<TypingStrip labels={['Bo Lin']} />)
  expect(!!findByText(tree, 'Bo Lin is typing…'), 'typing sentence').toBe(true)
})

test('the icons mount native SVG, not a DOM svg host tag', () => {
  // `lucide-react` would mount nothing here. The SVG primitives fork to
  // react-native-svg, whose host component differs per platform — which is also
  // why the harness always builds ios AND android.
  for (const [name, { tree }] of [
    ['Hash', render(<HashIcon />)],
    ['Send', render(<SendIcon />)],
  ] as const) {
    const svgHosts = findAll(tree as never, (type) => /RNSVG/.test(String(type)))
    expect(svgHosts.length > 0, `${name} mounts an RNSVG host`).toBe(true)
  }
})

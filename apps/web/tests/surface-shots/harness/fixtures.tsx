/**
 * Fixtures for the surface-shot gate — the REAL team and chat surfaces, mounted
 * whole, driven by fakes at the seams the components already take as props.
 *
 * This is deliberately not `visual-surface/`. That harness captures computed
 * STYLE over primitives and answers "did the token/animation migration change
 * output". This one takes PICTURES of composed product screens at a phone and a
 * desktop viewport, because the failure it exists to catch is the one no
 * assertion in this repo can see: a container that collapses to zero height
 * renders the surface blank while every gate stays green.
 *
 * The seams:
 *  - team: `TeamChannelsView` already takes `client: TeamClient` — so a
 *    hand-written in-memory client drives the whole real surface.
 *  - chat: `useStore` is a plain Zustand store, so a seeded transcript renders
 *    the real `ChatView` without a socket.
 */
import * as React from 'react'
import { TeamChannelsView } from '@lmthing/ui/team'
import type { TeamClient } from '@lmthing/ui/team'
import { ChatView } from '@lmthing/ui/chat/app/ChatView'
import { useStore } from '@lmthing/ui/chat/store/store'
import type { ConvoBlock } from '@lmthing/ui/chat/store/model'

// ─── team ────────────────────────────────────────────────────────────────────

const ME = 'u-me'
// Real wall-clock, rounded to the hour so the relative labels ("4h", "2d") are
// stable between runs. A FIXED past instant would make everything read "just
// now" once the clock passed it, which hides whatever `relativeTime` really does.
const NOW = Math.floor(Date.now() / 3_600_000) * 3_600_000
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString()

const MEMBERS = [
  { userId: ME, email: 'you@lmthing.org', displayName: 'You', handle: 'you', joinedAt: at(9000), updatedAt: at(9000) },
  { userId: 'u-ana', email: 'ana@lmthing.org', displayName: 'Ana Ruiz', handle: 'ana', joinedAt: at(8000), updatedAt: at(8000) },
  { userId: 'u-bo', email: 'bo@lmthing.org', displayName: 'Bo Okafor', handle: 'bo', joinedAt: at(7000), updatedAt: at(7000) },
  { userId: 'u-kim', email: 'kim@lmthing.org', displayName: 'Kim Park', handle: 'kim', joinedAt: at(6000), updatedAt: at(6000) },
]

const CHANNELS = [
  { id: 'c-general', name: 'general', createdBy: ME, createdAt: at(9000), kind: 'channel' as const, categoryId: 'cat-team' },
  { id: 'c-design', name: 'design', createdBy: 'u-ana', createdAt: at(8000), kind: 'channel' as const, categoryId: 'cat-team' },
  { id: 'c-standup', name: 'standup', createdBy: 'u-bo', createdAt: at(7000), kind: 'channel' as const, categoryId: 'cat-team' },
  { id: 'c-launch', name: 'launch-plan', createdBy: 'u-kim', createdAt: at(6000), kind: 'channel' as const, categoryId: 'cat-projects', apps: ['p-tracker'] },
  { id: 'c-dm-ana', name: 'dm', createdBy: ME, createdAt: at(500), kind: 'dm' as const, members: [ME, 'u-ana'] },
]

const CATEGORIES = [
  { id: 'cat-team', name: 'Team', order: 0 },
  { id: 'cat-projects', name: 'Projects', order: 1 },
]

const UNREAD = [
  { channelId: 'c-design', hasUnread: true, mentions: 2 },
  { channelId: 'c-standup', hasUnread: true, mentions: 0 },
]

const GENERAL: unknown[] = [
  { id: 'm1', ts: at(240), channelId: 'c-general', kind: 'user', text: 'Morning — the passwordless login is live on prod, both web and the phone.', userId: 'u-ana', email: 'ana@lmthing.org' },
  { id: 'm2', ts: at(238), channelId: 'c-general', kind: 'user', text: 'Nice. Did the cross-device magic link get sorted?', userId: 'u-bo', email: 'bo@lmthing.org' },
  { id: 'm3', ts: at(236), channelId: 'c-general', kind: 'user', text: 'Yes — origin cookie, same shape as the Claude app. Opening the link on a second device now tells you to type the code on the first.', userId: 'u-ana', email: 'ana@lmthing.org' },
  { id: 'm4', ts: at(120), channelId: 'c-general', kind: 'user', text: '@thing can you summarise what shipped this week and how many of those changes touched the mobile app?', userId: ME, email: 'you@lmthing.org', mentions: ['thing'] },
  {
    id: 'm5', ts: at(119), channelId: 'c-general', kind: 'thing', threadId: 'm4',
    text: '',
    blocks: [
      { type: 'markdown', props: { text: '**Seven changes shipped this week.** Four of them touched the mobile app:\n\n- passwordless email sign-in (native, no webview)\n- the cross-device magic-link cookie\n- team invite emails\n- THING answering inside a team thread' } },
    ],
  },
  { id: 'm6', ts: at(60), channelId: 'c-general', kind: 'user', text: 'That tracks. I want the thread affordance to be more obvious on the phone though — right now you can barely tell a message has replies.', userId: 'u-kim', email: 'kim@lmthing.org' },
  // Carries a URL, a mention and an email in one line: the three things message text is scanned
  // for. The email is here to prove it does NOT become a mention chip.
  { id: 'm7', ts: at(6), channelId: 'c-general', kind: 'user', text: 'Agreed. Filed at https://github.com/lmthing/bug-reports/issues/42 — (@ana, can you take it?) or mail ann@example.com.', userId: 'u-bo', email: 'bo@lmthing.org' },
]

const THREAD: unknown[] = [
  ...GENERAL.filter((m) => (m as { id: string }).id === 'm4' || (m as { id: string }).id === 'm5'),
  { id: 't1', ts: at(118), channelId: 'c-general', kind: 'user', text: 'Which of those four is riskiest?', userId: ME, email: 'you@lmthing.org', threadId: 'm4' },
  {
    id: 't2', ts: at(117), channelId: 'c-general', kind: 'thing', threadId: 'm4', text: '',
    blocks: [{ type: 'markdown', props: { text: 'The thread work — it has never run against a real pod. The other three were verified live.' } }],
  },
]

const MESSAGES: Record<string, unknown[]> = {
  'c-general': GENERAL,
  'c-design': [
    { id: 'd1', ts: at(30), channelId: 'c-design', kind: 'user', text: 'Pushed the new empty states — @you have a look when you can', userId: 'u-ana', email: 'ana@lmthing.org', mentions: [ME] },
  ],
  'c-standup': [{ id: 's1', ts: at(400), channelId: 'c-standup', kind: 'user', text: 'Standup in 10.', userId: 'u-bo', email: 'bo@lmthing.org' }],
  'c-launch': [{ id: 'l1', ts: at(900), channelId: 'c-launch', kind: 'user', text: 'Tracker app is pinned above.', userId: 'u-kim', email: 'kim@lmthing.org' }],
  'c-dm-ana': [{ id: 'x1', ts: at(45), channelId: 'c-dm-ana', kind: 'user', text: 'Sending you the invite now.', userId: 'u-ana', email: 'ana@lmthing.org' }],
}

/** An in-memory `TeamClient`. Every method resolves; none of them touch the network. */
export function fakeTeamClient(overrides: { messages?: Record<string, unknown[]> } = {}): TeamClient {
  const messages = { ...MESSAGES, ...(overrides.messages ?? {}) }
  const ok = <T,>(v: T) => Promise.resolve(v)
  return {
    channels: () => ok({ channels: CHANNELS, categories: CATEGORIES, unread: UNREAD }),
    createChannel: (name: string) => ok({ channel: { ...CHANNELS[0], id: `c-${name}`, name }, created: true }),
    patchChannel: (id: string) => ok({ channel: CHANNELS.find((c) => c.id === id) ?? CHANNELS[0] }),
    messages: (channelId: string) => ok({ messages: (messages[channelId] ?? []) as never, hasMore: false }),
    postMessage: (channelId: string, text: string) =>
      ok({ message: { id: `new-${text.length}`, ts: at(0), channelId, kind: 'user', text, userId: ME } as never }),
    markRead: () => ok({ ok: true as const }),
    openDm: () => ok({ channel: CHANNELS[4], created: false }),
    createCategory: (name: string) => ok({ category: { id: `cat-${name}`, name, order: 2 }, created: true }),
    deleteCategory: (id: string) => ok({ deleted: id }),
    directory: () => ok({ members: MEMBERS, projects: [{ id: 'p-tracker', name: 'Launch tracker', hasApp: true }] }),
    profile: () => ok({ profile: MEMBERS[0] }),
    setProfile: () => ok({ profile: MEMBERS[0] }),
    // No socket in a shot: `entry.tsx` stubs `WebSocket`, so this URL is never dialled.
    socketUrl: () => ok('ws://localhost:0/api/team/ws'),
  } as unknown as TeamClient
}

function Team({ rail, channel = 'c-general' }: { rail?: { kind: 'thread'; threadId: string }; channel?: string }) {
  const client = React.useMemo(
    () => fakeTeamClient(rail ? { messages: { 'c-general': THREAD } } : {}),
    [rail],
  )
  return (
    <TeamChannelsView
      client={client}
      isEditor
      activeChannelId={channel}
      rail={rail ?? null}
      onSelectChannel={() => {}}
      onOpenThread={() => {}}
      onOpenApp={() => {}}
      onCloseRail={() => {}}
      appUrl={(id) => `/app/${id}`}
      team={{ id: 't1', name: 'lmthing' }}
      teams={[{ id: 't1', name: 'lmthing' }, { id: 't2', name: 'side project' }]}
      onSwitchTeam={() => {}}
    />
  )
}

// ─── chat ────────────────────────────────────────────────────────────────────

const md = (text: string) => ({ type: 'markdown', props: { text } })

const TRANSCRIPT: ConvoBlock[] = [
  { id: 'b1', ts: NOW - 600_000, nodeId: 'n1', type: 'user', content: 'What changed in the team surface this week?' },
  {
    id: 'b2', ts: NOW - 599_000, nodeId: 'n1', type: 'display',
    descriptor: md(
      'Four fixes landed in team channels:\n\n1. a reply in a thread no longer needs a second `@thing`\n2. the reply shows `display()` output, not the agent\'s source\n3. a turn that displays nothing now ends loudly instead of silently\n4. `ask()` in a thread is answerable\n\nStill open:\n\n- none of it has run against a real pod\n- the thread affordance is faint on a phone',
    ),
  },
  { id: 'b3', ts: NOW - 300_000, nodeId: 'n2', type: 'user', content: 'Show me the riskiest one and why.' },
  {
    id: 'b4', ts: NOW - 299_000, nodeId: 'n2', type: 'display',
    descriptor: md('The `ask()` work. A parked turn holds the thread\'s lock, and the first version of it would have hung pod shutdown forever — that only surfaced because the test suite hung on it.'),
  },
  { id: 'b5', ts: NOW - 120_000, nodeId: 'n3', type: 'error', message: 'Model call failed: budget window exhausted (30d).' },
]

function seedChat() {
  useStore.setState({
    mode: 'live',
    connection: 'open',
    sessionId: 'sess-fixture',
    model: {
      nodes: {
        n3: { id: 'n3', kind: 'turn', status: 'running', label: 'Answering', startedAt: NOW - 5_000 },
      } as never,
      rootId: 'n3',
      blocks: TRANSCRIPT,
      rawEvents: [],
      lastSeq: 12,
    } as never,
  } as never)
}

function Chat() {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    seedChat()
    setReady(true)
  }, [])
  if (!ready) return null
  return <ChatView />
}

function ChatEmpty() {
  React.useEffect(() => {
    useStore.setState({ mode: 'live', connection: 'connecting', sessionId: '', model: { nodes: {}, rootId: null, blocks: [], rawEvents: [], lastSeq: 0 } } as never)
  }, [])
  return <ChatView />
}

// ─── registry ────────────────────────────────────────────────────────────────

// A conversation taller than any viewport. Its job is to prove the bottom-anchoring in
// `Prim.Scroll` did NOT make the start of an overflowing transcript unreachable — the failure mode
// of doing it with `justify-content: flex-end`. The first message says so, so a shot taken at
// scrollTop 0 shows whether it can still be reached.
const LONG: unknown[] = [
  { id: 'g0', ts: at(600), channelId: 'c-general', kind: 'user', text: 'FIRST MESSAGE — if you can read this at the top of the scroll, overflow is still reachable.', userId: 'u-ana', email: 'ana@lmthing.org' },
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `g${i + 1}`,
    ts: at(590 - i * 10),
    channelId: 'c-general',
    kind: 'user' as const,
    text: `Filler message ${i + 1} — enough of these and the transcript overflows its container.`,
    userId: i % 2 ? 'u-bo' : 'u-kim',
    email: i % 2 ? 'bo@lmthing.org' : 'kim@lmthing.org',
  })),
]

export const FIXTURES: Record<string, () => React.ReactElement> = {
  team: () => <Team />,
  'team-long': () => {
    const client = React.useMemo(() => fakeTeamClient({ messages: { 'c-general': LONG } }), [])
    return (
      <TeamChannelsView
        client={client}
        isEditor
        activeChannelId="c-general"
        rail={null}
        onSelectChannel={() => {}}
        onOpenThread={() => {}}
        onOpenApp={() => {}}
        onCloseRail={() => {}}
        appUrl={(id) => `/app/${id}`}
        team={{ id: 't1', name: 'lmthing' }}
      />
    )
  },
  'team-thread': () => <Team rail={{ kind: 'thread', threadId: 'm4' }} />,
  'team-dm': () => <Team channel="c-dm-ana" />,
  chat: () => <Chat />,
  'chat-empty': () => <ChatEmpty />,
}

export const FIXTURE_NAMES = Object.keys(FIXTURES)

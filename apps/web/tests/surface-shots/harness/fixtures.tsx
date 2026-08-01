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
import { DevPanel } from '@lmthing/ui/chat/app/DevPanel'
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
export function fakeTeamClient(
  overrides: {
    messages?: Record<string, unknown[]>
    hasMore?: boolean
    /** Never resolve `uploadAttachment` — how the `team-attachments` fixture freezes the composer
     *  in its "Uploading…" state for the screenshot, instead of racing a real upload against the
     *  shot being taken. */
    neverResolveUpload?: boolean
  } = {},
): TeamClient {
  const messages = { ...MESSAGES, ...(overrides.messages ?? {}) }
  const ok = <T,>(v: T) => Promise.resolve(v)
  return {
    channels: () => ok({ channels: CHANNELS, categories: CATEGORIES, unread: UNREAD }),
    createChannel: (name: string) => ok({ channel: { ...CHANNELS[0], id: `c-${name}`, name }, created: true }),
    patchChannel: (id: string) => ok({ channel: CHANNELS.find((c) => c.id === id) ?? CHANNELS[0] }),
    // `before` is the pod's real paging cursor; answering it with an older page is what makes the
    // "Load earlier messages" affordance appear AND do something, rather than just render.
    messages: (channelId: string, opts?: { limit?: number; before?: string }) =>
      ok({
        messages: (opts?.before
          ? OLDER
          : (messages[channelId] ?? [])) as never,
        hasMore: opts?.before ? false : overrides.hasMore === true,
      }),
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
    uploadAttachment: overrides.neverResolveUpload
      ? () => new Promise<never>(() => {})
      : (input: { filename?: string; mediaType: string }) =>
          ok({ id: `up-${input.filename ?? 'file'}`, kind: 'file', url: '#', mediaType: input.mediaType, filename: input.filename }),
    // No real pod behind this harness, so no token to append — the fixtures that need a real
    // image (`team-attachments`) hand `MESSAGES` a `data:` URL directly, which needs nothing
    // resolved onto it.
    attachmentUrl: (url: string) => url,
  } as unknown as TeamClient
}

// A tiny inline SVG standing in for a real screenshot — an actual `data:` image so the attachment
// fixture below renders a real thumbnail rather than a broken-image icon (there is no pod behind
// this harness to serve `/api/uploads/*`).
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
      '<rect width="320" height="200" fill="#d8dee8"/>' +
      '<text x="160" y="105" font-family="sans-serif" font-size="16" fill="#4b5563" text-anchor="middle">empty-state.png</text>' +
      '</svg>',
  )

// Two sent messages carrying an attachment — the two states `messages.tsx` renders differently
// (an image thumbnail vs. a named file chip). Appended to `general`'s own transcript rather than a
// dedicated empty channel, so the fixture also proves an attachment sits correctly alongside a
// transcript that already has ordinary text messages in it.
const ATTACHMENT_MESSAGES: unknown[] = [
  ...GENERAL,
  {
    id: 'att-img', ts: at(3), channelId: 'c-general', kind: 'user', userId: 'u-kim', email: 'kim@lmthing.org',
    text: 'Redline for the empty state, before/after',
    attachments: [{ id: 'att-img-1', kind: 'image', url: PLACEHOLDER_IMAGE, mediaType: 'image/png', filename: 'empty-state.png' }],
  },
  {
    id: 'att-file', ts: at(2), channelId: 'c-general', kind: 'user', userId: 'u-bo', email: 'bo@lmthing.org',
    text: 'Full write-up is attached',
    attachments: [{ id: 'att-file-1', kind: 'file', url: '#', mediaType: 'application/pdf', filename: 'design-review.pdf' }],
  },
]

/**
 * The three attachment states in one screenshot: a sent image, a sent file, and — via a real
 * (synthetic) file-pick through the composer's own hidden input — the composer FROZEN mid-upload.
 * `fakeTeamClient({ neverResolveUpload: true })` never resolves the upload, so "Uploading…" is
 * still showing when the shot is taken; a feature nobody can see is a feature nobody can review.
 */
function TeamAttachments() {
  const client = React.useMemo(
    () => fakeTeamClient({ messages: { 'c-general': ATTACHMENT_MESSAGES }, neverResolveUpload: true }),
    [],
  )
  React.useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="attach-input"]')
    if (!input) return
    const file = new File(['# Q3 roadmap notes'], 'roadmap-notes.md', { type: 'text/markdown' })
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, [])
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
    // The live "currently doing" sentence, which renders directly above the composer. Seeded
    // because it is only ever on screen mid-turn — the state a still picture would otherwise
    // never catch, and the one where the space between transcript and input gets crowded.
    activity: 'Reading the team channel routes',
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
  // A project id, because the app-pages row above the composer is a property of the SELECTED
  // project — with none there is nothing to link to and the row is absent by design. The manifest
  // it reads is answered by the harness's `fetch` stub (see `entry.tsx`).
  return <ChatView projectId="trips" />
}

function ChatEmpty() {
  React.useEffect(() => {
    useStore.setState({ mode: 'live', connection: 'connecting', sessionId: '', model: { nodes: {}, rootId: null, blocks: [], rawEvents: [], lastSeq: 0 } } as never)
  }, [])
  return <ChatView />
}

/**
 * `DevPanel` (execution tree + inspector + replay bar) — the one part of the chat surface this
 * gate had never photographed. Round 2 of the `--lm-*` → shared-token migration finished it off
 * (`app/tree.tsx`, `app/inspector.tsx`, `app/replay.tsx`, `app/DevPanel.tsx` all used the bridged
 * alias before; see `org/docs/design-system/README.md`), and every color in it changed as a
 * result — a mechanical `var(--lm-x)` → `var(--x)` rename, but this is the only gate that can
 * actually SEE whether the rename kept every token resolving to a real colour instead of an
 * absent one. Seeded with one node of each interesting status (done/running/error) and one
 * retried statement, so the tree's status/kind colours and the inspector's error/result/retry
 * colours all paint. `mode: 'replay'` so the playback bar (the fourth migrated file) shows too.
 */
function seedDevPanel() {
  useStore.setState({
    mode: 'replay',
    connection: 'closed',
    selectedNodeId: 'n2',
    tab: 'statements',
    expanded: new Set(['n1']),
    replay: { events: [], cursor: 3, playing: false, speed: 1 },
    model: {
      rootId: 'n1',
      rawEvents: [],
      lastSeq: 0,
      blocks: [],
      nodes: {
        n1: {
          id: 'n1', parentId: null, kind: 'session', label: 'THING', status: 'done',
          childIds: ['n2', 'n3'], depTaskIds: [], llmCalls: [], statements: [], yields: [],
          variables: {}, eventSeqs: [], durationMs: 4200,
        },
        n2: {
          id: 'n2', parentId: 'n1', kind: 'fork', label: 'audit team surface', status: 'error',
          childIds: [], depTaskIds: [], eventSeqs: [], durationMs: 1800,
          error: 'typecheck: Property \'threadId\' does not exist on type \'Channel\'.',
          llmCalls: [{
            ts: NOW - 4000, model: 'gpt-5', system: 'You are THING.',
            messages: [{ role: 'user', content: 'Audit the team surface for regressions.' }],
            responses: [{ attempt: 1, ts: NOW - 3800, text: 'Checking thread locking…' }],
          }],
          statements: [{
            ts: NOW - 3900, code: 'const t = channel.threadId;',
            errors: [{ phase: 'typecheck', message: "Property 'threadId' does not exist on type 'Channel'.", attempt: 1 }],
          }],
          yields: [
            { ts: NOW - 3700, kind: 'db.query', args: { table: 'channels' }, resolved: true, value: { rows: 3 } },
            { ts: NOW - 3600, kind: 'ask', args: { prompt: 'confirm?' }, resolved: false },
          ],
          variables: { channel: '{ id: "c-general" }' },
        },
        n3: {
          id: 'n3', parentId: 'n1', kind: 'delegate', label: 'write the fix', status: 'running',
          childIds: [], depTaskIds: [], llmCalls: [], statements: [], yields: [],
          variables: {}, eventSeqs: [], startTs: NOW - 1000,
        },
      },
    } as never,
  } as never)
}

function ChatDevPanel() {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    seedDevPanel()
    setReady(true)
  }, [])
  if (!ready) return null
  return (
    <div style={{ height: '100vh', display: 'flex' }}>
      <DevPanel onClose={() => {}} height="100%" />
    </div>
  )
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

// One page further back, returned when the view asks with a `before` cursor. Its first line says
// so, because the only way to know paging WORKED — rather than merely offering a button — is to
// see older content arrive above what was already there.
const OLDER: unknown[] = Array.from({ length: 8 }, (_, i) => ({
  id: `old${i}`,
  ts: at(2000 - i * 10),
  channelId: 'c-general',
  kind: 'user' as const,
  text: i === 0 ? 'OLDER PAGE — this only exists behind the paging cursor.' : `Older message ${i}.`,
  userId: i % 2 ? 'u-ana' : 'u-kim',
  email: i % 2 ? 'ana@lmthing.org' : 'kim@lmthing.org',
}))

/**
 * The two fixtures that hold a hook live as NAMED components rather than inline in `FIXTURES`.
 *
 * `entry.tsx` renders these as `<Fixture />`, so a hook inside one is legal — but a fixture's
 * "name" is its object key (`'team-long'`), and neither a linter nor a profiler can tell a
 * hook-holding component from an arbitrary callback by that. `react-hooks/rules-of-hooks` reported
 * both as errors for exactly that reason, and it is not wrong to: the same body one refactor away
 * from being CALLED instead of rendered would run its `useMemo` against the harness's fibre.
 * A capitalised declaration is what makes the intent checkable.
 */
function TeamLong() {
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
}

/** A channel the pod says has MORE history behind it — see the `team-paging` entry below. */
function TeamPaging() {
  const client = React.useMemo(() => fakeTeamClient({ hasMore: true }), [])
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
}

export const FIXTURES: Record<string, () => React.ReactElement> = {
  team: () => <Team />,
  'team-long': () => <TeamLong />,
  'team-thread': () => <Team rail={{ kind: 'thread', threadId: 'm4' }} />,
  'team-dm': () => <Team channel="c-dm-ana" />,
  'team-attachments': () => <TeamAttachments />,
  // A channel the pod says has MORE history behind it. Exists to photograph the "Load earlier
  // messages" affordance, which is invisible in every other fixture because they all report
  // `hasMore: false` — a feature nobody can see is a feature nobody can review.
  'team-paging': () => <TeamPaging />,
  chat: () => <Chat />,
  'chat-empty': () => <ChatEmpty />,
  'chat-devpanel': () => <ChatDevPanel />,
}

export const FIXTURE_NAMES = Object.keys(FIXTURES)

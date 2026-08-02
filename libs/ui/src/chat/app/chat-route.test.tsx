import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../theme/tamagui.config'
import { ChatShell } from './ChatShell'
import { useStore } from '../store/store'
import type { ChatLocation } from './chat-nav'

/**
 * The chat surface's LOCATION — which project, which conversation — and the one direction it flows.
 *
 * Before this, both lived only in the zustand store: the URL said `/chat` no matter what was on
 * screen, so a conversation could not be linked, reloading lost it, and the back button left the
 * surface entirely because nothing inside it had ever pushed an entry. These cases pin the contract
 * that fixed it — the location is the source of truth, the store and the socket follow it, and the
 * push/replace choice is made on whether the USER asked for the navigation or the app did.
 *
 * `session-control` is mocked because what is being tested here is which calls the location
 * produces, not the socket; `session-control.test.ts` covers the socket side.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const h = vi.hoisted(() => ({ connected: null as string | null, fail: null as number | null }))

vi.mock('./session-control', () => ({
  getConnectedSessionId: () => h.connected,
  openSession: vi.fn(async (_projectId: string | null, sessionId: string) => {
    if (h.fail) {
      const { ApiError } = await import('./api')
      throw new ApiError(`POST /api/sessions → ${h.fail}`, h.fail)
    }
    h.connected = sessionId
  }),
  closeActiveSession: vi.fn(() => { h.connected = null }),
  startSession: vi.fn(async () => 's-new'),
  switchSession: vi.fn(),
  resumeSession: vi.fn(),
}))

import { openSession, closeActiveSession, startSession } from './session-control'

const PROJECTS = [
  { id: 'user', name: 'Personal', createdAt: '2024-01-01T00:00:00.000Z' },
  { id: 'trips', name: 'Trips', createdAt: '2024-01-01T00:00:00.000Z' },
]

/** The pod calls the mounted shell makes on its own — the sidebar's lists, and prices. */
async function stubFetch(url: unknown): Promise<Response> {
  const path = String(url)
  if (path.includes('/sessions')) return new Response(JSON.stringify({ sessions: [] }))
  if (path.includes('/spaces')) return new Response(JSON.stringify({ spaces: [] }))
  if (path.includes('/api/projects')) return new Response(JSON.stringify({ projects: PROJECTS }))
  return new Response(JSON.stringify({}))
}

function renderShell(location: ChatLocation, onNavigate = vi.fn()) {
  const result = render(
    <P>
      <ChatShell
        projectId={location.projectId}
        sessionId={location.sessionId}
        onNavigate={onNavigate}
      />
    </P>,
  )
  const rerender = (next: ChatLocation) =>
    result.rerender(
      <P>
        <ChatShell projectId={next.projectId} sessionId={next.sessionId} onNavigate={onNavigate} />
      </P>,
    )
  return { ...result, rerender, onNavigate }
}

describe('chat — the location is the source of truth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.connected = null
    h.fail = null
    useStore.setState({ projects: [], activeProjectId: null, activeSessionId: null })
    vi.stubGlobal('fetch', vi.fn(stubFetch))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves a location with no project to the default one, REPLACING the entry', async () => {
    const { onNavigate } = renderShell({ projectId: null, sessionId: null })
    // Replace, not push: the user asked for "chat" and this is the app answering. A pushed entry
    // would make Back re-ask the question and be answered the same way — a trap.
    await vi.waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith({ projectId: 'user', sessionId: null }, { replace: true }),
    )
  })

  it('leaves a location that already names a project alone', async () => {
    const { onNavigate } = renderShell({ projectId: 'trips', sessionId: null })
    await vi.waitFor(() => expect(useStore.getState().projects).toHaveLength(2))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(useStore.getState().activeProjectId).toBe('trips')
  })

  it('opens the conversation the location names', async () => {
    renderShell({ projectId: 'trips', sessionId: 's-42' })
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledWith('trips', 's-42'))
  })

  it('opens a conversation on a COLD load, before the project list has arrived', async () => {
    // A pasted link must not wait on `/api/projects`: the conversation is addressable on its own.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never resolves
    renderShell({ projectId: 'trips', sessionId: 's-42' })
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledWith('trips', 's-42'))
  })

  it('closes the conversation when the location goes back to the project', async () => {
    const { rerender } = renderShell({ projectId: 'trips', sessionId: 's-42' })
    await vi.waitFor(() => expect(h.connected).toBe('s-42'))

    // What the browser's Back button does after opening a chat from `/chat/trips`.
    rerender({ projectId: 'trips', sessionId: null })
    await vi.waitFor(() => expect(closeActiveSession).toHaveBeenCalled())
    expect(useStore.getState().activeSessionId).toBe(null)
  })

  it('leaves nothing of the closed conversation behind', async () => {
    const { rerender } = renderShell({ projectId: 'trips', sessionId: 's-42' })
    await vi.waitFor(() => expect(h.connected).toBe('s-42'))
    useStore.setState({ sessionTitle: 'Trip Planner App', selectedNodeId: 'n-9' })

    rerender({ projectId: 'trips', sessionId: null })

    // Caught in a real browser: Back kept the old chat's name in the tab title and its node id in
    // `?node=`, which the store subscription then wrote back onto a URL where it named nothing.
    await vi.waitFor(() => expect(useStore.getState().sessionTitle).toBe(''))
    expect(useStore.getState().selectedNodeId).toBe(null)
  })

  it('reopens the previous conversation when the location goes back to it', async () => {
    const { rerender } = renderShell({ projectId: 'trips', sessionId: 's-a' })
    await vi.waitFor(() => expect(h.connected).toBe('s-a'))
    rerender({ projectId: 'trips', sessionId: 's-b' })
    await vi.waitFor(() => expect(h.connected).toBe('s-b'))

    // Back — the same location as two entries ago, and it has to work as well the second time.
    rerender({ projectId: 'trips', sessionId: 's-a' })
    await vi.waitFor(() => expect(h.connected).toBe('s-a'))
    expect(openSession).toHaveBeenCalledTimes(3)
  })

  it('does not reconnect when the location changes but the conversation does not', async () => {
    const { rerender } = renderShell({ projectId: 'trips', sessionId: 's-42' })
    await vi.waitFor(() => expect(openSession).toHaveBeenCalledTimes(1))
    rerender({ projectId: 'trips', sessionId: 's-42' })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(closeActiveSession).not.toHaveBeenCalled()
  })

  it('says so when the conversation in the link is gone, and offers a way on', async () => {
    h.fail = 400
    const { container } = renderShell({ projectId: 'trips', sessionId: 's-dead' })
    await vi.waitFor(() => expect(container.textContent).toContain('That conversation isn’t here'))
    // The dead end this replaces was a permanently blank pane, so the actions are the point.
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent)
    expect(labels).toContain('+ New chat')
    expect(labels).toContain('Your conversations')
  })

  it('leaving a dead conversation REPLACES, so Back never returns to it', async () => {
    h.fail = 400
    const { container, onNavigate } = renderShell({ projectId: 'trips', sessionId: 's-dead' })
    await vi.waitFor(() => expect(container.textContent).toContain('That conversation isn’t here'))
    const back = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Your conversations',
    )!
    fireEvent.click(back)
    expect(onNavigate).toHaveBeenCalledWith({ projectId: 'trips', sessionId: null }, { replace: true })
  })

  it('starting a new chat from the dead-conversation pane PUSHES the new one', async () => {
    h.fail = 400
    const { container, onNavigate } = renderShell({ projectId: 'trips', sessionId: 's-dead' })
    await vi.waitFor(() => expect(container.textContent).toContain('That conversation isn’t here'))
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '+ New chat')!,
    )
    await vi.waitFor(() => expect(startSession).toHaveBeenCalledWith('trips'))
    // A chat the user asked for is a place they can come Back FROM.
    await vi.waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        { projectId: 'trips', sessionId: 's-new' },
        { replace: false },
      ),
    )
  })

  it('never blames the conversation for a pod that is merely busy', async () => {
    // A cold pod answers 503 for the ~20s it takes to wake. Telling the user their chat is gone
    // would be a lie they cannot check — and the offered action would destroy the evidence.
    h.fail = 503
    const { container } = renderShell({ projectId: 'trips', sessionId: 's-42' })
    await vi.waitFor(() => expect(container.textContent).toContain('Couldn’t open that conversation'))
    expect(container.textContent).not.toContain('isn’t here')
    expect(container.textContent).toContain('still be waking up')
  })

  it('retries the same conversation at the same URL', async () => {
    h.fail = 503
    const { container } = renderShell({ projectId: 'trips', sessionId: 's-42' })
    await vi.waitFor(() => expect(container.textContent).toContain('Couldn’t open that conversation'))

    h.fail = null // the pod finished waking
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Try again')!,
    )
    // The location never changed, so only the retry counter can re-run the open.
    await vi.waitFor(() => expect(h.connected).toBe('s-42'))
    expect(container.textContent).not.toContain('Couldn’t open')
  })

  it('says so when the project in the link is gone', async () => {
    const { container } = renderShell({ projectId: 'ghost', sessionId: null })
    await vi.waitFor(() => expect(container.textContent).toContain('That project isn’t here'))
    expect(container.textContent).toContain('Open Personal')
  })

  it('shows the conversation as opening rather than as absent', async () => {
    // The bug: a cold deep link rendered "No conversation open" plus a New chat button for the
    // whole resume — false, and the obvious thing to press started a DIFFERENT conversation.
    let release: () => void = () => {}
    vi.mocked(openSession).mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = () => { h.connected = 's-42'; resolve() } }),
    )
    const { container } = renderShell({ projectId: 'trips', sessionId: 's-42' })
    await vi.waitFor(() => expect(container.textContent).toContain('Opening conversation…'))
    expect(container.textContent).not.toContain('No conversation open')
    release()
    await vi.waitFor(() => expect(container.textContent).not.toContain('Opening conversation…'))
  })
})

describe('chat — no host to navigate with (desktop, mobile)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.connected = null
    h.fail = null
    useStore.setState({ projects: [], activeProjectId: null, activeSessionId: null })
    vi.stubGlobal('fetch', vi.fn(stubFetch))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the location in the store, so the default project still resolves', async () => {
    // No `onNavigate`: a window and a phone have no history stack, and the surface has to work
    // exactly the same without one. `redirect` writes the store instead of a URL.
    render(
      <P>
        <ChatShell />
      </P>,
    )
    await vi.waitFor(() => expect(useStore.getState().activeProjectId).toBe('user'))
  })
})

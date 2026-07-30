import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../theme/tamagui.config'
import { NoSessionPane } from './NoSessionPane'
import { useStore } from '../store/store'

/**
 * The chat surface's no-conversation pane.
 *
 * The bug this pins: the pane used to render the single sentence "Select or start a chat from the
 * sidebar." On a phone the sidebar is an overlay drawer, so once it was closed the user was left
 * with a blank screen, one instruction naming a thing that was not on screen, and nothing to press.
 * Every case here is about the pane being an ENTRY POINT rather than a description of one.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const label = (el: Element | null) => el?.textContent ?? ''
const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button'))

describe('NoSessionPane', () => {
  beforeEach(() => {
    useStore.getState().setSidebarOpen(true)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessionId: 's1' }))))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers a New chat button when a project is active', () => {
    const { container } = render(
      <P>
        <NoSessionPane activeProjectId="user" sidebarIsDrawer={false} />
      </P>,
    )
    expect(buttons(container).map(label)).toContain('+ New chat')
  })

  it('never tells a phone user to use a sidebar that is off screen', () => {
    const { container } = render(
      <P>
        <NoSessionPane activeProjectId="user" sidebarIsDrawer />
      </P>,
    )
    expect(container.textContent).not.toContain('sidebar')
  })

  it('adds a drawer opener ONLY where the sidebar is a drawer', () => {
    const drawer = render(
      <P>
        <NoSessionPane activeProjectId="user" sidebarIsDrawer />
      </P>,
    )
    expect(buttons(drawer.container).map(label)).toContain('Your conversations')

    const docked = render(
      <P>
        <NoSessionPane activeProjectId="user" sidebarIsDrawer={false} />
      </P>,
    )
    // On web the sidebar is already visible beside this pane — a button to reveal it would be a
    // second control for something that is not hidden.
    expect(buttons(docked.container).map(label)).not.toContain('Your conversations')
  })

  it('opens the drawer rather than navigating', () => {
    useStore.getState().setSidebarOpen(false)
    const { container } = render(
      <P>
        <NoSessionPane activeProjectId="user" sidebarIsDrawer />
      </P>,
    )
    const opener = buttons(container).find((b) => label(b) === 'Your conversations')!
    fireEvent.click(opener)
    expect(useStore.getState().sidebarOpen).toBe(true)
  })

  it('creates a session and makes it active when New chat is pressed', async () => {
    useStore.getState().setActiveSessionId(null)
    const { container } = render(
      <P>
        <NoSessionPane activeProjectId="user" sidebarIsDrawer={false} />
      </P>,
    )
    fireEvent.click(buttons(container).find((b) => label(b) === '+ New chat')!)
    await vi.waitFor(() => expect(useStore.getState().activeSessionId).toBe('s1'))

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain('/api/sessions')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ projectId: 'user' })
  })

  it('offers no New chat button with no project to create it in', () => {
    const { container } = render(
      <P>
        <NoSessionPane activeProjectId={null} sidebarIsDrawer={false} />
      </P>,
    )
    expect(buttons(container).map(label)).not.toContain('+ New chat')
    expect(container.textContent).toContain('Select or create a project')
  })
})

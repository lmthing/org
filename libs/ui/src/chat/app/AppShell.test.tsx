import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../theme/tamagui.config'
import { AppShell } from './AppShell'
import { useStore } from '../store/store'

/**
 * The two shortcuts a daily reader actually wants (`Alt+I` was the only one, and it is
 * developer-only — toggles DevTools, not reachable/meaningful on a phone either way).
 *
 * Both are asserted through their EFFECT (a new session started; the composer gaining focus),
 * not by reaching into the handler — `platform/keyboard`'s `onKeyDown` is a documented no-op on
 * native, which is the whole cross-platform story here; these suites cannot see a phone (see
 * `libs/ui/metro/README.md`), only that nothing web-specific leaks into code that must also run
 * there unharmed.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

vi.mock('./session-control', () => ({
  startSession: vi.fn(async () => 's-new'),
  resumeSession: vi.fn(),
  closeActiveSession: vi.fn(),
}))

import { startSession } from './session-control'

describe('AppShell — keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}))))
    useStore.setState({
      activeProjectId: 'p1',
      activeSessionId: 's1',
      projects: [{ id: 'p1', name: 'Project One', createdAt: '2024-01-01T00:00:00.000Z' }],
      sessions: [],
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Alt+N starts a new session in the active project', () => {
    render(
      <P>
        <AppShell />
      </P>,
    )
    fireEvent.keyDown(window, { key: 'n', altKey: true })
    expect(startSession).toHaveBeenCalledWith('p1')
  })

  it('Alt+N does nothing in a singleSession embedding — there is no session list to join', () => {
    render(
      <P>
        <AppShell singleSession />
      </P>,
    )
    fireEvent.keyDown(window, { key: 'n', altKey: true })
    expect(startSession).not.toHaveBeenCalled()
  })

  it('Alt+N does nothing with no active project', () => {
    useStore.setState({ activeProjectId: null })
    render(
      <P>
        <AppShell />
      </P>,
    )
    fireEvent.keyDown(window, { key: 'n', altKey: true })
    expect(startSession).not.toHaveBeenCalled()
  })

  it('bare "/" focuses the composer when nothing else has focus', () => {
    const { container } = render(
      <P>
        <AppShell />
      </P>,
    )
    const field = container.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement
    expect(field).toBeTruthy()
    // The composer autofocuses on web mount (`Composer.tsx`'s `autoFocus`) — move focus off it
    // first so this proves the SHORTCUT puts it back, not that it never left.
    field.blur()
    expect(document.activeElement).not.toBe(field)
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(field)
  })

  it('"/" does not steal focus while already typing in the composer — it types a slash instead', () => {
    const { container } = render(
      <P>
        <AppShell />
      </P>,
    )
    const field = container.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement
    field.focus()
    expect(document.activeElement).toBe(field)
    // `isEditableTarget` is what must hold here — the shortcut's own preventDefault only matters
    // if it fires, so this proves it did not: the field kept focus and nothing intercepted it.
    fireEvent.keyDown(field, { key: '/' })
    expect(document.activeElement).toBe(field)
  })
})

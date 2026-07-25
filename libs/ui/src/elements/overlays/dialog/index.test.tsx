import { render, fireEvent, cleanup } from '@testing-library/react'
import * as React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'
import { Dialog, DialogContent, DialogTitle, DialogClose } from './index'

/**
 * B3.4: the Radix-free, Prim.*-based Dialog. Behaviour is unit-testable in jsdom (unlike a Tamagui
 * portal's a11y, which needed a device) — open renders a portal'd role="dialog", ESC and backdrop
 * close it, controlled open/onOpenChange is respected, and `asChild` uses the child as the title.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">{children}</TamaguiProvider>
)

// Portals append to document.body; clean up between tests so a stale backdrop isn't queried.
afterEach(cleanup)

describe('Dialog (Prim.*-based)', () => {
  it('renders nothing when closed and a portal role="dialog" when open', () => {
    const { queryByRole, rerender } = render(
      <P><Dialog open={false}><DialogContent><DialogTitle>T</DialogTitle></DialogContent></Dialog></P>,
    )
    expect(queryByRole('dialog')).toBeNull()
    rerender(<P><Dialog open><DialogContent><DialogTitle>T</DialogTitle></DialogContent></Dialog></P>)
    const dlg = queryByRole('dialog')!
    expect(dlg).not.toBeNull()
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(document.body.contains(dlg)).toBe(true) // portaled to body
  })

  it('ESC and backdrop click call onOpenChange(false)', () => {
    let open = true
    const { queryByRole } = render(
      <P><Dialog open onOpenChange={(o) => { open = o }}><DialogContent><DialogTitle>Hi</DialogTitle></DialogContent></Dialog></P>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(open).toBe(false)
    open = true
    // Post-swap the backdrop carries $-token props, not a `.dialog__backdrop` class. It is the
    // first child of the portaled role="dialog" viewport (see DialogContent).
    fireEvent.click(queryByRole('dialog')!.firstElementChild!)
    expect(open).toBe(false)
  })

  it('DialogClose closes; DialogTitle asChild renders the child as the title', () => {
    let open = true
    const { getByTestId } = render(
      <P>
        <Dialog open onOpenChange={(o) => { open = o }}>
          <DialogContent>
            <DialogTitle asChild><h3 data-testid="custom-title">Custom</h3></DialogTitle>
            <DialogClose data-testid="x">close</DialogClose>
          </DialogContent>
        </Dialog>
      </P>,
    )
    expect(getByTestId('custom-title').tagName).toBe('H3') // asChild → no wrapper tag
    fireEvent.click(getByTestId('x'))
    expect(open).toBe(false)
  })
})

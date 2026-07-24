import { render, fireEvent, cleanup } from '@testing-library/react'
import * as React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'
import { Sheet, SheetContent, SheetTitle } from './index'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">{children}</TamaguiProvider>
)
afterEach(cleanup)

describe('Sheet (Prim.*-based)', () => {
  it('renders a portal role="dialog" with the side class when open, ESC closes', () => {
    let open = true
    const { queryByRole } = render(
      <P><Sheet open onOpenChange={(o) => { open = o }}><SheetContent side="left"><SheetTitle>T</SheetTitle></SheetContent></Sheet></P>,
    )
    const el = queryByRole('dialog')!
    expect(el).not.toBeNull()
    expect(document.querySelector('.sheet--left')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(open).toBe(false)
  })

  it('renders nothing when closed', () => {
    const { queryByRole } = render(
      <P><Sheet open={false}><SheetContent><SheetTitle>T</SheetTitle></SheetContent></Sheet></P>,
    )
    expect(queryByRole('dialog')).toBeNull()
  })
})

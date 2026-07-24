import { render, fireEvent, cleanup } from '@testing-library/react'
import * as React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'
import * as ContextMenu from './index'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">{children}</TamaguiProvider>
)
afterEach(cleanup)

describe('ContextMenu (Prim.*-based)', () => {
  it('opens at the cursor on right-click and closes on item select', () => {
    let picked = false
    const { getByTestId, queryByRole } = render(
      <P>
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <div data-testid="target">right-click me</div>
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Item onClick={() => { picked = true }}>Delete</ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
      </P>,
    )
    expect(queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(getByTestId('target'), { clientX: 40, clientY: 60 })
    const menu = queryByRole('menu')!
    expect(menu).not.toBeNull()
    expect(menu.style.left).toBe('40px')
    expect(menu.style.top).toBe('60px')
    expect(document.body.contains(menu)).toBe(true) // portaled
    fireEvent.click(menu.querySelector('[role="menuitem"]')!)
    expect(picked).toBe(true)
    expect(queryByRole('menu')).toBeNull() // select closes
  })
})

import { render, fireEvent, cleanup } from '@testing-library/react'
import * as React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../../theme/tamagui.config'
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from './index'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">{children}</TamaguiProvider>
)
afterEach(cleanup)

describe('Dropdown (Prim.*-based)', () => {
  it('toggles the menu on trigger click and selecting an item closes it', () => {
    let picked = false
    const { getByText, queryByRole } = render(
      <P>
        <Dropdown>
          <DropdownTrigger>Menu</DropdownTrigger>
          <DropdownContent>
            <DropdownItem onClick={() => { picked = true }}>Item A</DropdownItem>
          </DropdownContent>
        </Dropdown>
      </P>,
    )
    expect(queryByRole('menu')).toBeNull() // closed by default
    fireEvent.click(getByText('Menu'))
    expect(queryByRole('menu')).not.toBeNull() // open
    fireEvent.click(getByText('Item A'))
    expect(picked).toBe(true)
    expect(queryByRole('menu')).toBeNull() // selecting closes
  })

  it('sets aria-expanded/haspopup on the trigger', () => {
    const { getByText } = render(
      <P><Dropdown><DropdownTrigger>Menu</DropdownTrigger><DropdownContent><DropdownItem>x</DropdownItem></DropdownContent></Dropdown></P>,
    )
    const trigger = getByText('Menu').closest('[aria-haspopup]')!
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})

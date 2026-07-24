import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  OverlayDropdownFrame,
  OverlayDropdownTriggerFrame,
  OverlayDropdownContentFrame,
  OverlayDropdownItemFrame,
  StyledOverlayDropdown,
} from './dropdown.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate — `.dropdown` chrome ⇄ styled() (docs §4; overlay chrome only, interactivity is P4). */
const root = (OverlayDropdownFrame as unknown as { staticConfig: any }).staticConfig
const trigger = (OverlayDropdownTriggerFrame as unknown as { staticConfig: any }).staticConfig
const content = (OverlayDropdownContentFrame as unknown as { staticConfig: any }).staticConfig
const item = (OverlayDropdownItemFrame as unknown as { staticConfig: any }).staticConfig

describe('.dropdown → styled() chrome', () => {
  it('anchor is relative; trigger is an inline-flex row', () => {
    expect(root.defaultProps).toMatchObject({ position: 'relative' })
    expect(trigger.defaultProps).toMatchObject({ display: 'inline-flex', alignItems: 'center', gap: '$1' })
  })

  it('__content is a z-50 min-w-32 popover surface with a shadow', () => {
    expect(content.defaultProps).toMatchObject({
      zIndex: 50,
      minWidth: '$32',
      backgroundColor: '$popover',
      color: '$popover-foreground',
      borderRadius: '$radius-md',
      shadowColor: 'rgba(0,0,0,0.1)',
    })
  })

  it('__item has an accent hover and a disabled state', () => {
    expect(item.defaultProps.hoverStyle).toMatchObject({ backgroundColor: '$accent', color: '$accent-foreground' })
    expect(item.defaultProps.disabledStyle).toMatchObject({ pointerEvents: 'none', opacity: 0.5 })
  })
})

describe('StyledOverlayDropdown renders', () => {
  it('renders the anchor chrome', () => {
    const { container } = render(
      <P>
        <StyledOverlayDropdown />
      </P>,
    )
    expect(container.querySelector('.is_OverlayDropdown')).toBeTruthy()
  })
})

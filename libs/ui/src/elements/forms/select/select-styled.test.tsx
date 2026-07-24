import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { SelectFrame, SelectTriggerFrame, SelectContentFrame, StyledSelect } from './select.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/**
 * P2 proof gate (leaf) — the `.select` BEM block ⇄ Tamagui `styled()`
 * (docs/tamagui-idiomatic-migration.md §4). Structurally faithful: the wrapper is positioned, the
 * trigger carries the `.select__trigger` @apply tokens, and the content box carries the floating
 * listbox tokens.
 */
const trigger = (SelectTriggerFrame as unknown as { staticConfig: any }).staticConfig
const content = (SelectContentFrame as unknown as { staticConfig: any }).staticConfig
const wrapper = (SelectFrame as unknown as { staticConfig: any }).staticConfig

describe('.select → styled() structure', () => {
  it('.select wrapper is relatively positioned', () => {
    expect(wrapper.defaultProps).toMatchObject({ position: 'relative' })
  })

  it('.select__trigger carries the trigger @apply tokens (var-backed colors + Tailwind scales)', () => {
    expect(trigger.defaultProps).toMatchObject({
      height: '$9',
      width: '100%',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: '$radius-md',
      borderColor: '$input',
      backgroundColor: '$background',
      paddingHorizontal: '$3',
      paddingVertical: '$2',
      fontSize: '$sm',
      placeholderTextColor: '$muted-foreground',
    })
  })

  it('.select__content carries the floating listbox tokens (z-50 literal, popover surface)', () => {
    expect(content.defaultProps).toMatchObject({
      position: 'absolute',
      zIndex: 50,
      minWidth: '100%',
      overflow: 'hidden',
      backgroundColor: '$popover',
      color: '$popover-foreground',
    })
  })
})

describe('StyledSelect renders', () => {
  it('renders the native select trigger inside the wrapper', () => {
    const { container } = render(
      <P>
        <StyledSelect>
          <option value="a">A</option>
        </StyledSelect>
      </P>,
    )
    expect(container.querySelector('.is_Select')).toBeTruthy()
    expect(container.querySelector('.is_SelectTrigger')).toBeTruthy()
  })
})

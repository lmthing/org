import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { ListItemFrame, ListItemLabelFrame, ListItemMetaFrame, StyledListItem } from './list-item.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.list-item` family ⇄ styled() + variants (docs §4). */
const item = (ListItemFrame as unknown as { staticConfig: any }).staticConfig
const label = (ListItemLabelFrame as unknown as { staticConfig: any }).staticConfig
const meta = (ListItemMetaFrame as unknown as { staticConfig: any }).staticConfig

describe('.list-item → styled() structure', () => {
  it('base carries the row tokens + hover accent', () => {
    expect(item.defaultProps).toMatchObject({
      alignItems: 'center',
      gap: '$3',
      paddingHorizontal: '$3',
      paddingVertical: '$2',
      borderRadius: '$radius-md',
      fontSize: '$sm',
      cursor: 'pointer',
    })
    expect(item.defaultProps.hoverStyle).toMatchObject({ backgroundColor: '$accent', color: '$accent-foreground' })
  })

  it('exposes a `selected` boolean variant', () => {
    expect(item.variants.selected.true).toMatchObject({
      backgroundColor: '$accent',
      color: '$accent-foreground',
      fontWeight: '$medium',
    })
  })

  it('.list-item__label truncates + grows; __meta is muted + shrink-0', () => {
    expect(label.defaultProps).toMatchObject({
      flexGrow: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: '$foreground',
    })
    expect(meta.defaultProps).toMatchObject({ fontSize: '$xs', color: '$muted-foreground', flexShrink: 0 })
  })
})

describe('StyledListItem renders', () => {
  it('renders label + meta parts when provided', () => {
    const { container } = render(<P><StyledListItem selected label="Item" meta="3" /></P>)
    expect(container.querySelector('.is_ListItem')).toBeTruthy()
    expect(container.querySelector('.is_ListItemLabel')).toBeTruthy()
    expect(container.querySelector('.is_ListItemMeta')).toBeTruthy()
  })
})

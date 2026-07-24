import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  FunctionsEditorFrame,
  FunctionsEditorHeaderFrame,
  FunctionsEditorListItemFrame,
  FunctionsEditorListItemActionsFrame,
  FunctionsEditorNewFormFrame,
  StyledFunctionsEditor,
} from './functions.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const editor = (FunctionsEditorFrame as unknown as { staticConfig: any }).staticConfig
const header = (FunctionsEditorHeaderFrame as unknown as { staticConfig: any }).staticConfig
const item = (FunctionsEditorListItemFrame as unknown as { staticConfig: any }).staticConfig
const actions = (FunctionsEditorListItemActionsFrame as unknown as { staticConfig: any }).staticConfig
const form = (FunctionsEditorNewFormFrame as unknown as { staticConfig: any }).staticConfig

describe('.functions-editor → styled()', () => {
  it('base is a full-height gapped column', () => {
    expect(editor.defaultProps).toMatchObject({ display: 'flex', flexDirection: 'column', height: '100%', gap: '$4' })
  })

  it('header carries the bottom border on the border token', () => {
    expect(header.defaultProps).toMatchObject({ borderBottomWidth: 1, borderBottomColor: '$border' })
  })

  it('list-item exposes a hover tint + `active` variant', () => {
    expect(item.defaultProps.hoverStyle).toMatchObject({ backgroundColor: 'var(--color-surface-hover, rgba(0,0,0,0.04))' })
    expect(item.variants.active.true).toMatchObject({ backgroundColor: 'var(--color-surface-active, rgba(0,0,0,0.07))' })
  })

  it('actions default to hidden with a `revealed` variant', () => {
    expect(actions.defaultProps).toMatchObject({ opacity: 0 })
    expect(actions.variants.revealed.true).toMatchObject({ opacity: 1 })
  })

  it('new-form is a dashed subtle-tint row', () => {
    expect(form.defaultProps).toMatchObject({ borderStyle: 'dashed', borderColor: '$border', borderRadius: '$radius-md' })
  })
})

describe('StyledFunctionsEditor renders', () => {
  it('renders the base frame', () => {
    const { container } = render(<P><StyledFunctionsEditor /></P>)
    expect(container.querySelector('.is_FunctionsEditor')).toBeTruthy()
  })
})

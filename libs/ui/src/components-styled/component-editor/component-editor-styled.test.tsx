import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ComponentEditorFrame,
  ComponentEditorKindBadgeFrame,
  ComponentEditorListItemFrame,
  ComponentEditorListItemActionsFrame,
  ComponentEditorNewFormFrame,
  StyledComponentEditor,
} from './component-editor.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const editor = (ComponentEditorFrame as unknown as { staticConfig: any }).staticConfig
const badge = (ComponentEditorKindBadgeFrame as unknown as { staticConfig: any }).staticConfig
const item = (ComponentEditorListItemFrame as unknown as { staticConfig: any }).staticConfig
const actions = (ComponentEditorListItemActionsFrame as unknown as { staticConfig: any }).staticConfig
const form = (ComponentEditorNewFormFrame as unknown as { staticConfig: any }).staticConfig

describe('.component-editor → styled()', () => {
  it('base is a full-height gapped column', () => {
    expect(editor.defaultProps).toMatchObject({ display: 'flex', flexDirection: 'column', height: '100%', gap: '$4' })
  })

  it('kind-badge exposes view/form tint variants via color-mix', () => {
    expect(badge.variants.kind.view).toMatchObject({ backgroundColor: 'color-mix(in srgb, var(--knowledge) 15%, transparent)', color: '$knowledge' })
    expect(badge.variants.kind.form).toMatchObject({ backgroundColor: 'color-mix(in srgb, var(--success) 15%, transparent)', color: '$success' })
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

describe('StyledComponentEditor renders', () => {
  it('renders the base frame', () => {
    const { container } = render(<P><StyledComponentEditor /></P>)
    expect(container.querySelector('.is_ComponentEditor')).toBeTruthy()
  })
})

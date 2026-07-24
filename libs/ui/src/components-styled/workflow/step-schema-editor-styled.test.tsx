import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  SchemaEditorFrame,
  SchemaEditorModeBtnFrame,
  SchemaEditorAddBtnFrame,
  SchemaEditorCodeErrorFrame,
  PropertyRowFrame,
  PropertyRowMainFrame,
  PropertyRowTypeIconFrame,
  PropertyRowRequiredBtnFrame,
  PropertyRowNestedFrame,
  NestedPropertiesFrame,
  StyledStepSchemaEditor,
} from './step-schema-editor.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const editor = (SchemaEditorFrame as unknown as { staticConfig: any }).staticConfig
const modeBtn = (SchemaEditorModeBtnFrame as unknown as { staticConfig: any }).staticConfig
const addBtn = (SchemaEditorAddBtnFrame as unknown as { staticConfig: any }).staticConfig
const codeError = (SchemaEditorCodeErrorFrame as unknown as { staticConfig: any }).staticConfig
const row = (PropertyRowFrame as unknown as { staticConfig: any }).staticConfig
const rowMain = (PropertyRowMainFrame as unknown as { staticConfig: any }).staticConfig
const typeIcon = (PropertyRowTypeIconFrame as unknown as { staticConfig: any }).staticConfig
const requiredBtn = (PropertyRowRequiredBtnFrame as unknown as { staticConfig: any }).staticConfig
const nested = (PropertyRowNestedFrame as unknown as { staticConfig: any }).staticConfig
const nestedProps = (NestedPropertiesFrame as unknown as { staticConfig: any }).staticConfig

describe('.schema-editor → styled()', () => {
  it('base is a clipped muted shell', () => {
    expect(editor.defaultProps).toMatchObject({ backgroundColor: '$muted', overflow: 'hidden' })
  })
  it('__mode-btn active variant lifts onto a card surface', () => {
    expect(modeBtn.defaultProps.hoverStyle).toMatchObject({ color: '$foreground' })
    expect(modeBtn.variants.active.true).toMatchObject({ backgroundColor: '$card', color: '$foreground' })
  })
  it('__add-btn is a dashed brand-3-hover button', () => {
    expect(addBtn.defaultProps).toMatchObject({ borderStyle: 'dashed', color: '$muted-foreground' })
    expect(addBtn.defaultProps.hoverStyle).toMatchObject({ borderColor: '$brand-3', color: '$brand-3' })
  })
  it('__code-error keeps the raw Tailwind red var', () => {
    expect(codeError.defaultProps).toMatchObject({ color: 'var(--color-red-500)' })
  })
})

describe('.property-row → styled()', () => {
  it('base is a bordered card', () => {
    expect(row.defaultProps).toMatchObject({ borderWidth: 1, borderColor: '$border', backgroundColor: '$card' })
  })
  it('__main clickable variant adds pointer + muted hover', () => {
    expect(rowMain.variants.clickable.true).toMatchObject({ cursor: 'pointer' })
    expect(rowMain.variants.clickable.true.hoverStyle).toMatchObject({ backgroundColor: '$muted' })
  })
  it('__type-icon carries a per-type color variant', () => {
    expect(typeIcon.variants.type.string).toMatchObject({ color: '$brand-1' })
    expect(typeIcon.variants.type.array).toMatchObject({ color: '$destructive' })
  })
  it('__required-btn required/optional variants', () => {
    expect(requiredBtn.variants.state.required).toMatchObject({ color: '$destructive' })
    expect(requiredBtn.variants.state.optional).toMatchObject({ backgroundColor: '$muted' })
  })
  it('__nested tints muted at 50%', () => {
    expect(nested.defaultProps).toMatchObject({
      backgroundColor: 'color-mix(in srgb, var(--muted) 50%, transparent)',
    })
  })
})

describe('.nested-properties → styled()', () => {
  it('base is a flex column', () => {
    expect(nestedProps.defaultProps).toMatchObject({ flexDirection: 'column', gap: '$2' })
  })
})

describe('StyledStepSchemaEditor renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledStepSchemaEditor /></P>)
    expect(container.querySelector('.is_SchemaEditor')).toBeTruthy()
  })
})

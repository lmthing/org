import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  WorkflowEditorFrame,
  WorkflowEditorHeaderFrame,
  WorkflowEditorHeaderInnerFrame,
  WorkflowEditorIconBoxFrame,
  WorkflowEditorMetaFormFrame,
  WorkflowEditorMetaFullFrame,
  WorkflowEditorTagBtnFrame,
  WorkflowEditorInsertBtnFrame,
  WorkflowEditorOutputPanelFrame,
  StyledWorkflowEditor,
} from './workflow-editor.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const root = (WorkflowEditorFrame as unknown as { staticConfig: any }).staticConfig
const header = (WorkflowEditorHeaderFrame as unknown as { staticConfig: any }).staticConfig
const inner = (WorkflowEditorHeaderInnerFrame as unknown as { staticConfig: any }).staticConfig
const iconBox = (WorkflowEditorIconBoxFrame as unknown as { staticConfig: any }).staticConfig
const metaForm = (WorkflowEditorMetaFormFrame as unknown as { staticConfig: any }).staticConfig
const metaFull = (WorkflowEditorMetaFullFrame as unknown as { staticConfig: any }).staticConfig
const tagBtn = (WorkflowEditorTagBtnFrame as unknown as { staticConfig: any }).staticConfig
const insertBtn = (WorkflowEditorInsertBtnFrame as unknown as { staticConfig: any }).staticConfig
const output = (WorkflowEditorOutputPanelFrame as unknown as { staticConfig: any }).staticConfig

describe('.workflow-editor → styled()', () => {
  it('base fills the screen over a muted surface', () => {
    expect(root.defaultProps).toMatchObject({ minHeight: '100vh', backgroundColor: '$muted' })
  })
  it('__header is a sticky card bar', () => {
    expect(header.defaultProps).toMatchObject({ position: 'sticky', top: 0, zIndex: 20, backgroundColor: '$card' })
  })
  it('__header-inner adds responsive padding at $gtXs/$gtMd', () => {
    expect(inner.defaultProps).toMatchObject({
      maxWidth: '56rem',
      marginHorizontal: 'auto',
      $gtXs: { paddingLeft: '$6', paddingRight: '$6' },
      $gtMd: { paddingLeft: '$8', paddingRight: '$8' },
    })
  })
  it('__icon-box is a solid brand-5 tile', () => {
    expect(iconBox.defaultProps).toMatchObject({ backgroundColor: '$brand-5' })
  })
  it('__meta-form is a 1-col grid → 2-col at $gtXs', () => {
    expect(metaForm.defaultProps).toMatchObject({
      display: 'grid',
      gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
      $gtXs: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
    })
  })
  it('__meta-full spans the grid', () => {
    expect(metaFull.defaultProps).toMatchObject({ gridColumn: '1 / -1', $gtXs: { gridColumn: 'span 2 / span 2' } })
  })
  it('__tag-btn active/inactive variants', () => {
    expect(tagBtn.variants.state.active).toMatchObject({ color: '$brand-5' })
    expect(tagBtn.variants.state.inactive).toMatchObject({ backgroundColor: '$muted', color: '$muted-foreground' })
  })
  it('__insert-btn hides until the `revealed` variant', () => {
    expect(insertBtn.defaultProps).toMatchObject({ opacity: 0 })
    expect(insertBtn.variants.revealed.true).toMatchObject({ opacity: 1 })
  })
  it('__output-panel keeps the two-tone gradient as backgroundImage', () => {
    expect(output.defaultProps.backgroundImage).toContain('linear-gradient')
    expect(output.defaultProps).toMatchObject({
      borderColor: 'color-mix(in srgb, var(--brand-5) 30%, transparent)',
    })
  })
})

describe('StyledWorkflowEditor renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledWorkflowEditor /></P>)
    expect(container.querySelector('.is_WorkflowEditor')).toBeTruthy()
  })
})

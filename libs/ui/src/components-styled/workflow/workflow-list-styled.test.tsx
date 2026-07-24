import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  WorkflowListHeaderInnerFrame,
  WorkflowListStatCountFrame,
  WorkflowListSearchIconFrame,
  WorkflowListTagBtnFrame,
  WorkflowListViewBtnFrame,
  WorkflowListGridFrame,
  WorkflowListEmptyFirstFrame,
  WorkflowListEmptyFirstIconWrapperFrame,
  StyledWorkflowList,
} from './workflow-list.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const inner = (WorkflowListHeaderInnerFrame as unknown as { staticConfig: any }).staticConfig
const count = (WorkflowListStatCountFrame as unknown as { staticConfig: any }).staticConfig
const searchIcon = (WorkflowListSearchIconFrame as unknown as { staticConfig: any }).staticConfig
const tagBtn = (WorkflowListTagBtnFrame as unknown as { staticConfig: any }).staticConfig
const viewBtn = (WorkflowListViewBtnFrame as unknown as { staticConfig: any }).staticConfig
const grid = (WorkflowListGridFrame as unknown as { staticConfig: any }).staticConfig
const emptyFirst = (WorkflowListEmptyFirstFrame as unknown as { staticConfig: any }).staticConfig
const emptyIcon = (WorkflowListEmptyFirstIconWrapperFrame as unknown as { staticConfig: any }).staticConfig

describe('.workflow-list → styled()', () => {
  it('__header-inner is a centered max-w-6xl with responsive padding', () => {
    expect(inner.defaultProps).toMatchObject({
      maxWidth: '72rem',
      marginHorizontal: 'auto',
      $gtMd: { paddingLeft: '$8', paddingRight: '$8' },
    })
  })
  it('__stat-count is bold foreground text', () => {
    expect(count.defaultProps).toMatchObject({ fontSize: '$2xl', fontWeight: '$bold', color: '$foreground' })
  })
  it('__search-icon is absolutely positioned + vertically centered', () => {
    expect(searchIcon.defaultProps).toMatchObject({ position: 'absolute', top: '50%', transform: 'translateY(-50%)' })
  })
  it('__tag-btn active/inactive variants', () => {
    expect(tagBtn.variants.state.active).toMatchObject({ color: '$brand-3' })
    expect(tagBtn.variants.state.inactive).toMatchObject({ backgroundColor: '$muted' })
  })
  it('__view-btn active carries a card surface + shadow', () => {
    expect(viewBtn.variants.state.active).toMatchObject({ backgroundColor: '$card', color: '$brand-3' })
    expect(viewBtn.variants.state.inactive.hoverStyle).toMatchObject({ color: '$foreground' })
  })
  it('__grid steps 1→2→3 columns across $gtSm/$gtMd', () => {
    expect(grid.defaultProps).toMatchObject({
      display: 'grid',
      $gtSm: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
      $gtMd: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
    })
  })
  it('__empty-first is a dashed card + solid brand-3 icon tile', () => {
    expect(emptyFirst.defaultProps).toMatchObject({ borderStyle: 'dashed', borderWidth: 2 })
    expect(emptyIcon.defaultProps).toMatchObject({ backgroundColor: '$brand-3' })
  })
})

describe('StyledWorkflowList renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledWorkflowList /></P>)
    expect(container.querySelector('.is_WorkflowListHeaderInner')).toBeTruthy()
  })
})

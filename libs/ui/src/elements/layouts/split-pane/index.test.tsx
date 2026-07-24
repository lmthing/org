import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: $-token PROPS → Tamagui atomic classes, not `.split-pane*` BEM classNames.
import { SplitPane, SplitPanePrimary, SplitPaneSecondary } from './index'

describe('SplitPane', () => {
  it('renders children', () => {
    render(<SplitPane>Content</SplitPane>)
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('is a full-height flex row that clips', () => {
    render(<SplitPane data-testid="pane">Content</SplitPane>)
    expect(screen.getByTestId('pane')).toHaveClass(
      '_dsp-flex', '_fd-row', '_height-10037', '_ox-hidden', '_oy-hidden',
    )
  })
})

describe('SplitPanePrimary', () => {
  it('flexes to fill and scrolls', () => {
    render(<SplitPanePrimary data-testid="primary">Primary</SplitPanePrimary>)
    expect(screen.getByTestId('primary')).toHaveClass(
      '_flexGrow-1', '_flexShrink-1', '_ox-auto', '_oy-auto',
    )
  })
})

describe('SplitPaneSecondary', () => {
  it('does not shrink and carries the left border', () => {
    render(<SplitPaneSecondary data-testid="secondary">Secondary</SplitPaneSecondary>)
    expect(screen.getByTestId('secondary')).toHaveClass(
      '_flexShrink-0', '_ox-auto', '_oy-auto', '_borderLeftWidth-1px', '_borderLeftColor-border',
    )
  })
})

import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: $-token PROPS → Tamagui atomic classes, not `.panel*` BEM classNames.
import { Panel, PanelHeader, PanelBody } from './index'

describe('Panel', () => {
  it('renders children', () => {
    render(<Panel>Panel content</Panel>)
    expect(screen.getByText('Panel content')).toBeInTheDocument()
  })

  it('is a bordered, clipping flex column on the background token', () => {
    render(<Panel data-testid="panel">Content</Panel>)
    expect(screen.getByTestId('panel')).toHaveClass(
      '_dsp-flex', '_fd-column', '_backgroundColor-background',
      '_btw-1px', '_brw-1px', '_borderBottomWidth-1px', '_borderLeftWidth-1px',
      '_btc-border', '_brc-border', '_borderBottomColor-border', '_borderLeftColor-border',
      '_ox-hidden', '_oy-hidden',
    )
  })

  it('lays out as a row when split', () => {
    render(<Panel data-testid="panel" split>Content</Panel>)
    expect(screen.getByTestId('panel')).toHaveClass('_fd-row')
  })
})

describe('PanelHeader', () => {
  it('is a space-between row with a bottom border', () => {
    render(<PanelHeader data-testid="header">Header</PanelHeader>)
    expect(screen.getByTestId('header')).toHaveClass(
      '_dsp-flex', '_alignItems-center', '_justifyContent-space-betwe3241',
      '_borderBottomWidth-1px', '_borderBottomColor-border',
    )
  })
})

describe('PanelBody', () => {
  it('flexes to fill, scrolls and pads', () => {
    render(<PanelBody data-testid="body">Body</PanelBody>)
    expect(screen.getByTestId('body')).toHaveClass(
      '_flexGrow-1', '_ox-auto', '_oy-auto', '_paddingTop-c-space-4',
    )
  })
})

import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: $-token PROPS → Tamagui atomic classes, not `.page*` BEM classNames.
import { Page, PageHeader, PageBody } from './index'

describe('Page', () => {
  it('renders children', () => {
    render(<Page>Page content</Page>)
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })

  it('is a min-screen-height flex column on the background token', () => {
    render(<Page data-testid="page">Content</Page>)
    expect(screen.getByTestId('page')).toHaveClass(
      '_dsp-flex', '_fd-column', '_minHeight-100vh', '_backgroundColor-background',
    )
  })

  it('pins to the viewport and clips when full', () => {
    render(<Page data-testid="page" full>Content</Page>)
    expect(screen.getByTestId('page')).toHaveClass('_height-100vh', '_ox-hidden', '_oy-hidden')
  })

  it('is not viewport-pinned when full is absent', () => {
    render(<Page data-testid="page">Content</Page>)
    expect(screen.getByTestId('page').className).not.toMatch(/_height-100vh/)
  })
})

describe('PageHeader', () => {
  it('is a centred row padded on the $space scale with a bottom border', () => {
    render(<PageHeader data-testid="header">Header</PageHeader>)
    expect(screen.getByTestId('header')).toHaveClass(
      '_dsp-flex',
      '_alignItems-center',
      '_paddingLeft-c-space-6',
      '_paddingRight-c-space-6',
      '_paddingTop-c-space-4',
      '_paddingBottom-c-space-4',
      '_borderBottomWidth-1px',
      '_borderBottomColor-border',
    )
  })
})

describe('PageBody', () => {
  it('flexes to fill, scrolls and pads on the $space scale', () => {
    render(<PageBody data-testid="body">Body</PageBody>)
    expect(screen.getByTestId('body')).toHaveClass(
      '_flexGrow-1', '_flexShrink-1', '_ox-auto', '_oy-auto', '_paddingTop-c-space-6',
    )
  })
})

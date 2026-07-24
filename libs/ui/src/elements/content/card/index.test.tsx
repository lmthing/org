import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: $-token PROPS → Tamagui atomic classes, not `.card*` BEM classNames.
import { Card, CardHeader, CardBody, CardFooter } from './index'

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText('Card content')).toBeInTheDocument()
  })

  it('carries the card surface tokens', () => {
    render(<Card data-testid="card">Content</Card>)
    expect(screen.getByTestId('card')).toHaveClass(
      '_btw-1px', '_brw-1px', '_borderBottomWidth-1px', '_borderLeftWidth-1px',
      '_btc-border', '_brc-border', '_borderBottomColor-border', '_borderLeftColor-border',
      '_backgroundColor-card',
    )
  })

  it('becomes a pointer target when interactive', () => {
    render(<Card data-testid="card" interactive>Content</Card>)
    expect(screen.getByTestId('card')).toHaveClass('_cur-pointer')
  })

  it('is not a pointer target by default', () => {
    render(<Card data-testid="card">Content</Card>)
    expect(screen.getByTestId('card').className).not.toMatch(/_cur-pointer/)
  })
})

describe('CardHeader', () => {
  it('is a padded flex column', () => {
    render(<CardHeader data-testid="header">Header</CardHeader>)
    expect(screen.getByTestId('header')).toHaveClass(
      '_dsp-flex', '_fd-column', '_paddingTop-c-space-4', '_paddingBottom-0px',
    )
  })
})

describe('CardBody', () => {
  it('pads on the $space scale', () => {
    render(<CardBody data-testid="body">Body</CardBody>)
    expect(screen.getByTestId('body')).toHaveClass('_paddingTop-c-space-4', '_paddingLeft-c-space-4')
  })
})

describe('CardFooter', () => {
  it('is a centred row with no top padding', () => {
    render(<CardFooter data-testid="footer">Footer</CardFooter>)
    expect(screen.getByTestId('footer')).toHaveClass(
      '_dsp-flex', '_alignItems-center', '_paddingTop-0px',
    )
  })
})

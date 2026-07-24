import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: $-token PROPS → Tamagui atomic classes, not `.avatar*` BEM classNames.
import { Avatar, AvatarFallback } from './index'

const withFallback = (props: Record<string, unknown> = {}) => (
  <Avatar data-testid="avatar" {...props}>
    <AvatarFallback>AB</AvatarFallback>
  </Avatar>
)

describe('Avatar', () => {
  it('renders a fallback', () => {
    render(withFallback())
    expect(screen.getByText('AB')).toBeInTheDocument()
  })

  it('is a round, clipping size-8 box on the muted token', () => {
    render(withFallback())
    expect(screen.getByTestId('avatar')).toHaveClass(
      '_dsp-flex', '_width-c-size-8', '_height-c-size-8',
      '_backgroundColor-muted', '_ox-hidden', '_oy-hidden',
    )
  })

  it('maps size=sm onto the $size scale', () => {
    render(withFallback({ size: 'sm' }))
    expect(screen.getByTestId('avatar')).toHaveClass('_width-c-size-6', '_height-c-size-6')
  })

  it('maps size=lg onto the $size scale', () => {
    render(withFallback({ size: 'lg' }))
    expect(screen.getByTestId('avatar')).toHaveClass('_width-c-size-12', '_height-c-size-12')
  })
})

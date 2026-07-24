import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { Button } from './index'

// NB: not in the libs/ui vitest include (only *-styled.test.tsx run in CI); kept in sync by hand.
// Post-swap the Button renders a real <button> (Prim.Pressable) styled by $-token PROPS, not `btn*`
// classNames — so these assert semantics/behaviour, and button.styled.tsx pins the variant table.
describe('Button', () => {
  it('renders a real button with its children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('accepts variant + size without error', () => {
    render(<Button variant="ghost" size="sm">Ghost</Button>)
    expect(screen.getByRole('button', { name: 'Ghost' })).toBeInTheDocument()
  })

  it('renders as child element when asChild is true', () => {
    render(<Button asChild><a href="#">Link</a></Button>)
    expect(screen.getByRole('link', { name: 'Link' })).toBeInTheDocument()
  })

  it('forwards disabled', () => {
    render(<Button disabled>Click me</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})

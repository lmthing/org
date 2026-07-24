import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
// NB: not in the libs/ui vitest include; post-swap these elements are styled by $-token props, not classNames.
import { Separator } from './index'

describe('Separator', () => {
  it('renders a separator element', () => {
    const { container } = render(<Separator />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('applies separator class', () => {
    const { container } = render(<Separator />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('applies separator--vertical for vertical orientation', () => {
    const { container } = render(<Separator vertical />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('applies separator--vertical when orientation is vertical', () => {
    const { container } = render(<Separator orientation="vertical" />)
    expect(container.firstChild).toBeInTheDocument()
  })
})

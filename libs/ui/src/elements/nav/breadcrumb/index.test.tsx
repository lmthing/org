import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: $-token PROPS → Tamagui atomic classes, not `.breadcrumb*` BEM classNames. The old
// `:last-child` rule is now an explicit `isCurrent` branch, so it is asserted on the real segment.
import { Breadcrumb } from './index'

const segments = [
  { label: 'Home' },
  { label: 'Studio' },
  { label: 'Space' },
]

describe('Breadcrumb', () => {
  it('renders all segments', () => {
    render(<Breadcrumb segments={segments} />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Studio')).toBeInTheDocument()
    expect(screen.getByText('Space')).toBeInTheDocument()
  })

  it('is a gapped, muted row', () => {
    render(<Breadcrumb segments={segments} />)
    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toHaveClass(
      '_dsp-flex', '_alignItems-center', '_gap-c-space-1',
    )
  })

  it('renders a separator between each pair of segments', () => {
    render(<Breadcrumb segments={segments} />)
    expect(document.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
  })

  it('marks the last segment as the current page and makes it unclickable', () => {
    render(<Breadcrumb segments={segments} />)
    const last = screen.getByText('Space')
    expect(last).toHaveAttribute('aria-current', 'page')
    expect(last).toHaveClass('_cur-default')
  })

  it('leaves earlier segments clickable', () => {
    render(<Breadcrumb segments={segments} />)
    expect(screen.getByText('Home')).toHaveClass('_cur-pointer')
  })
})

import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { Badge } from './index'

// NB: not in the libs/ui vitest include (only *-styled.test.tsx run in CI); kept in sync by hand.
// Post-swap the Badge renders a real <span> (Prim.Text) styled by $-token PROPS, not `badge*`
// classNames — so these assert rendering/variants; its retired `styled()` proof pins the variant table.
describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders each variant without error', () => {
    for (const variant of ['default', 'primary', 'muted', 'success'] as const) {
      render(<Badge variant={variant}>{variant}</Badge>)
      expect(screen.getByText(variant)).toBeInTheDocument()
    }
  })
})

import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: BOTH the `.sidebar` shell and `SidebarItem` are $-token props. The item's last
// blocker — router `<Link>`s, which take only className — is gone via studio/shell/nav-link.
import { Sidebar, SidebarItem } from './index'

describe('Sidebar', () => {
  it('renders a nav element', () => {
    render(<Sidebar>Content</Sidebar>)
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('is a full-height $64 column on the sidebar token', () => {
    render(<Sidebar>Content</Sidebar>)
    expect(screen.getByRole('navigation')).toHaveClass(
      '_dsp-flex', '_fd-column', '_width-c-size-64',
      '_backgroundColor-sidebar', '_brw-1px',
    )
  })

  it('narrows to $12 when collapsed', () => {
    render(<Sidebar collapsed>Content</Sidebar>)
    expect(screen.getByRole('navigation')).toHaveClass('_width-c-size-12')
  })
})

describe('SidebarItem', () => {
  it('is a padded, rounded row on the sidebar-foreground token', () => {
    render(<SidebarItem data-testid="item">Item</SidebarItem>)
    expect(screen.getByTestId('item')).toHaveClass(
      '_dsp-flex', '_alignItems-center', '_paddingLeft-c-space-3', '_cur-pointer',
    )
  })

  it('pins to the accent when active', () => {
    render(<SidebarItem data-testid="item" active>Item</SidebarItem>)
    expect(screen.getByTestId('item')).toHaveClass('_backgroundColor-sidebar-acc100587')
  })

  it('is not accent-filled by default', () => {
    render(<SidebarItem data-testid="item">Item</SidebarItem>)
    // the hover variant (`_backgroundColor-0hover-…`) is always present; only the unprefixed
    // fill is conditional, so match on a leading space to exclude it.
    expect(` ${screen.getByTestId('item').className}`).not.toMatch(/ _backgroundColor-sidebar-acc/)
  })
})

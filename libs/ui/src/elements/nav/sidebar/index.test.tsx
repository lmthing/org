import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap: the `.sidebar` SHELL is $-token props (atomic classes). `SidebarItem` is the one
// residual and stays className-driven — most call sites are router `<Link>`s that take no style
// props. See elements/nav/sidebar/index.tsx.
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
  it('keeps the sidebar__item class (router-Link residual)', () => {
    render(<SidebarItem data-testid="item">Item</SidebarItem>)
    expect(screen.getByTestId('item')).toHaveClass('sidebar__item')
  })

  it('applies sidebar__item--active when active is true', () => {
    render(<SidebarItem data-testid="item" active>Item</SidebarItem>)
    expect(screen.getByTestId('item')).toHaveClass('sidebar__item--active')
  })
})

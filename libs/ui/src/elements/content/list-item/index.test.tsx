import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { ListItem } from './index'

describe('ListItem', () => {
  it('renders children', () => {
    render(<ListItem>Item content</ListItem>)
    expect(screen.getByText('Item content')).toBeInTheDocument()
  })

  it('renders with selected without error', () => {
    render(<ListItem selected>Content</ListItem>)
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('renders label and meta when provided', () => {
    render(<ListItem label="My Label" meta="4 items" />)
    expect(screen.getByText('My Label')).toBeInTheDocument()
    expect(screen.getByText('4 items')).toBeInTheDocument()
  })
})

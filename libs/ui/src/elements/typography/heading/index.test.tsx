import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Heading } from './index'

describe('Heading', () => {
  it('renders an h2 by default', () => {
    render(<Heading>Title</Heading>)
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
  })

  it('renders correct heading tag for level', () => {
    render(<Heading level={1}>Title</Heading>)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('renders the h3/h4 tags for their levels', () => {
    render(<Heading level={3}>L3</Heading>)
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
  })

  it('renders with muted without error', () => {
    render(<Heading muted>Muted</Heading>)
    expect(screen.getByRole('heading', { name: 'Muted' })).toBeInTheDocument()
  })
})

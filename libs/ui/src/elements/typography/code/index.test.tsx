import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Code } from './index'

describe('Code', () => {
  it('renders inline code by default', () => {
    render(<Code>const x = 1</Code>)
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })

  it('renders a <code> element by default', () => {
    const { container } = render(<Code>snippet</Code>)
    expect(container.querySelector('code')).toBeInTheDocument()
  })

  it('renders in a pre element when block is true', () => {
    const { container } = render(<Code block>const x = 1</Code>)
    expect(container.querySelector('pre')).toBeInTheDocument()
  })
})

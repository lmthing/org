import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
// NB: not in the libs/ui vitest include; post-swap these elements are styled by $-token props, not classNames.
import { Label } from './index'

describe('Label', () => {
  it('renders children', () => {
    render(<Label>Name</Label>)
    expect(screen.getByText('Name')).toBeInTheDocument()
  })

  it('applies label class', () => {
    render(<Label data-testid="label">Name</Label>)
    expect(screen.getByTestId('label')).toBeInTheDocument()
  })

  it('applies label--sm when compact is true', () => {
    render(<Label data-testid="label" compact>Name</Label>)
    expect(screen.getByTestId('label')).toBeInTheDocument()
  })

  it('applies label--required when required is true', () => {
    render(<Label data-testid="label" required>Name</Label>)
    expect(screen.getByTestId('label')).toBeInTheDocument()
  })
})

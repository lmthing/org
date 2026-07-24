import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { Select, SelectOption } from './index'

describe('Select', () => {
  it('renders a select element', () => {
    render(
      <Select aria-label="choose">
        <SelectOption value="a">Option A</SelectOption>
      </Select>
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('is a real <select> carrying the trigger tokens', () => {
    render(<Select aria-label="choose" data-testid="select" />)
    const el = screen.getByTestId('select')
    expect(el.tagName).toBe('SELECT')
    expect(el).toHaveClass(
      '_dsp-flex', '_height-c-size-9', '_backgroundColor-background', '_fs-f-size-sm',
    )
  })

  it('sits inside the relatively-positioned wrapper', () => {
    const { container } = render(<Select aria-label="choose" data-testid="select" />)
    expect(container.querySelector('.\\_pos-relative')).toBeTruthy()
  })

  it('renders options', () => {
    render(
      <Select aria-label="choose">
        <SelectOption value="a">Alpha</SelectOption>
        <SelectOption value="b">Beta</SelectOption>
      </Select>
    )
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument()
  })

  it('forwards disabled prop', () => {
    render(<Select aria-label="choose" disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})

import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { Textarea } from './index'

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea placeholder="Enter text" />)
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
  })

  it('is a real <textarea> carrying the control tokens', () => {
    render(<Textarea data-testid="textarea" />)
    const el = screen.getByTestId('textarea')
    expect(el.tagName).toBe('TEXTAREA')
    expect(el).toHaveClass('_minHeight-c-size-20', '_backgroundColor-background', '_fs-f-size-sm')
  })

  it('is vertically resizable (resize-y has no Tamagui style key, so it rides on style)', () => {
    render(<Textarea data-testid="textarea" />)
    expect(screen.getByTestId('textarea').style.resize).toBe('vertical')
  })

  it('shrinks to the compact height', () => {
    render(<Textarea data-testid="textarea" compact />)
    expect(screen.getByTestId('textarea')).toHaveClass('_minHeight-c-size-14', '_fs-f-size-xs')
  })

  it('forwards disabled prop', () => {
    render(<Textarea data-testid="textarea" disabled />)
    expect(screen.getByTestId('textarea')).toBeDisabled()
  })
})

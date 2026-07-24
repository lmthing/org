import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { Input } from './index'

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input placeholder="Enter text" />)
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
  })

  it('is a real <input> carrying the control tokens', () => {
    render(<Input data-testid="input" />)
    const el = screen.getByTestId('input')
    expect(el.tagName).toBe('INPUT')
    expect(el).toHaveClass(
      '_height-c-size-9', '_backgroundColor-background', '_fs-f-size-sm',
      '_btc-input', '_borderBottomColor-input',
    )
  })

  it('borders on the destructive token when error is true', () => {
    render(<Input data-testid="input" error />)
    expect(screen.getByTestId('input')).toHaveClass('_btc-destructive', '_borderBottomColor-destructive')
  })

  it('is not destructive-bordered by default', () => {
    render(<Input data-testid="input" />)
    expect(screen.getByTestId('input').className).not.toMatch(/destructive/)
  })

  it('shrinks to the sm row height', () => {
    render(<Input data-testid="input" size="sm" />)
    expect(screen.getByTestId('input')).toHaveClass('_height-c-size-7', '_fs-f-size-xs')
  })

  it('drives ::placeholder through the Tamagui CSS var rather than a DOM attribute', () => {
    render(<Input data-testid="input" />)
    const el = screen.getByTestId('input')
    expect(el.style.getPropertyValue('--t_placeholderColor')).toBe('var(--muted-foreground)')
    expect(el.hasAttribute('placeholdertextcolor')).toBe(false)
  })

  it('forwards value and onChange', () => {
    render(<Input data-testid="input" defaultValue="hello" />)
    expect(screen.getByTestId('input')).toHaveValue('hello')
  })

  it('forwards disabled prop', () => {
    render(<Input data-testid="input" disabled />)
    expect(screen.getByTestId('input')).toBeDisabled()
  })
})

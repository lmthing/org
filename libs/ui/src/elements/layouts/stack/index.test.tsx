import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
// Post-swap the element is styled by $-token PROPS, not `.stack*` classNames. Tamagui compiles each
// prop to a deterministic ATOMIC class (`_dsp-flex`, `_gap-c-space-3`), so the assertions pin those:
// they name the property AND the resolved design token, which is a stronger gate than a px value
// (jsdom cannot compute Tamagui's stylesheet — its `@scope` rule fails jsdom's CSS parser).
import { Stack } from './index'

describe('Stack', () => {
  it('renders children', () => {
    render(<Stack>Content</Stack>)
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('is a real div, flex column by default', () => {
    render(<Stack data-testid="stack">Content</Stack>)
    const el = screen.getByTestId('stack')
    expect(el.tagName).toBe('DIV')
    expect(el).toHaveClass('_dsp-flex', '_fd-column')
  })

  it('is a flex row when row is true', () => {
    render(<Stack data-testid="stack" row>Content</Stack>)
    expect(screen.getByTestId('stack')).toHaveClass('_dsp-flex', '_fd-row')
  })

  it.each([
    ['sm', '_gap-c-space-1'],
    ['md', '_gap-c-space-3'],
    ['lg', '_gap-c-space-6'],
  ] as const)('maps gap=%s onto the $space scale (%s)', (gap, atomic) => {
    render(<Stack data-testid="stack" gap={gap}>Content</Stack>)
    expect(screen.getByTestId('stack')).toHaveClass(atomic)
  })

  it('emits no gap class when gap is omitted', () => {
    render(<Stack data-testid="stack">Content</Stack>)
    expect(screen.getByTestId('stack').className).not.toMatch(/_gap-/)
  })
})

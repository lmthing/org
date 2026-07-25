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

  // A gap that is NOT one of the three semantic keys used to be looked up in `GAP` anyway, which
  // returned `undefined` — so the gap was silently DROPPED rather than applied. That is reachable
  // from real callsites: the `style-bags-to-props` codemod emitted bags carrying the old CSS class's
  // literal `gap` (`{gap: '0.5rem'}`), and those bags are spread AFTER the semantic `gap="sm"`, so
  // the literal wins the prop merge and lands here. A raw value must pass straight through.
  it.each([
    // Tamagui encodes `.` in a raw length as `--`, so `0.5rem` → `_gap-0--5rem`.
    ['0.5rem', '_gap-0--5rem'],
    ['$2', '_gap-c-space-2'],
    [8, '_gap-8px'],
  ] as const)('passes a non-semantic gap (%s) through to the primitive', (gap, atomic) => {
    render(<Stack data-testid="stack" gap={gap}>Content</Stack>)
    expect(screen.getByTestId('stack')).toHaveClass(atomic)
  })
})

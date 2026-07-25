import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { CozyThingText } from './index'

/**
 * The shipped `CozyThingText`. This suite replaces the deleted `cozy-text-styled.test.tsx`, which
 * gated a parallel `styled()` copy nothing imported; these assertions are against the component
 * the app actually renders. See docs/tamagui-idiomatic-migration.md §4/§6.
 *
 * NOTE: assert against the element, never `container` — `TamaguiProvider` injects its stylesheet
 * into the same container, so `container.textContent` carries the whole CSS text with it.
 */
describe('CozyThingText', () => {
  it('splits the brand mark into per-letter spans, one colour token each', () => {
    render(<CozyThingText text="thing" data-testid="brand" />)
    const el = screen.getByTestId('brand')
    expect(el.textContent).toBe('thing')
    // t·h·i·n·g each get their own `$brand-N` colour — the former `.cozy-text--brand-N` modifiers.
    for (const n of [1, 2, 3, 4, 5]) expect(el.innerHTML).toContain(`_col-brand-${n}`)
  })

  it('renders the `lm` prefix in the neutral tone for `lmthing`', () => {
    render(<CozyThingText text="lmthing" data-testid="full" />)
    const el = screen.getByTestId('full')
    expect(el.textContent).toBe('lmthing')
    expect(el.innerHTML).toContain('_col-foreground')
  })

  it('keeps the original casing of a dotted suffix', () => {
    render(<CozyThingText text="lmthing.Studio" data-testid="dotted" />)
    expect(screen.getByTestId('dotted').textContent).toBe('lmthing.Studio')
  })

  it('is semibold by default, and a caller prop still wins', () => {
    render(<CozyThingText text="thing" data-testid="a" />)
    expect(screen.getByTestId('a').className).toMatch(/_fw-f-weight-se/)
    // Rest props spread AFTER the default weight, which is what lets a surface restyle the mark.
    render(<CozyThingText text="thing" data-testid="b" fontWeight="$bold" />)
    expect(screen.getByTestId('b').className).toMatch(/_fw-f-weight-bo\d/)
    expect(screen.getByTestId('b').className).not.toMatch(/_fw-f-weight-se/)
  })

  it('takes idiomatic style props (the presentation slides restyle the mark this way)', () => {
    render(<CozyThingText text="thing" data-testid="c" fontSize="$2xl" />)
    expect(screen.getByTestId('c')).toHaveClass('_fs-f-size-2xl')
  })
})

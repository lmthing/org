import { render, screen } from '../../test-utils/index'
import { describe, it, expect } from 'vitest'
import * as Prim from './index'

/**
 * Regression gate for the silently-dropped `$` font tokens.
 *
 * Tamagui keys the FONT scales (`fontSize`/`fontWeight`/`lineHeight`/`letterSpacing`) off the
 * component's font FAMILY. With no `fontFamily`, `fontSize="$sm"` resolves to nothing and Tamagui
 * drops the prop — no class, no warning — which is exactly what the P3 codemod and the element-layer
 * swap emit when they lift `text-sm`/`font-medium` off a className. `withFontScale` in `_tamagui.tsx`
 * defaults the family to `$body` for those calls only. See docs/tamagui-idiomatic-migration.md §5/§6.
 */
describe('$ font-scale tokens resolve on every text-capable primitive', () => {
  it.each([
    ['Text', <Prim.Text data-testid="x" fontSize="$sm" />],
    ['Box', <Prim.Box data-testid="x" fontSize="$sm" />],
    ['Pressable', <Prim.Pressable data-testid="x" fontSize="$sm" />],
    ['Link', <Prim.Link data-testid="x" fontSize="$sm" />],
    ['ListItem', <Prim.ListItem data-testid="x" fontSize="$sm" />],
    ['TextField', <Prim.TextField data-testid="x" fontSize="$sm" />],
    ['TextArea', <Prim.TextArea data-testid="x" fontSize="$sm" />],
    ['Select', <Prim.Select data-testid="x" fontSize="$sm" />],
  ])('%s emits the font-size atomic class', (_name, el) => {
    render(el)
    expect(screen.getByTestId('x')).toHaveClass('_fs-f-size-sm')
  })

  it('resolves the other three font scales too', () => {
    render(
      <Prim.Text data-testid="x" fontSize="$2xl" fontWeight="$semibold" lineHeight="$sm" letterSpacing="$tight" />,
    )
    const cls = screen.getByTestId('x').className
    expect(cls).toMatch(/_fs-f-size-2xl/)
    expect(cls).toMatch(/_fw-f-weight-/)
    expect(cls).toMatch(/_lh-f-lineHeigh/)
    expect(cls).toMatch(/_ls-f-letterSpa/)
  })

  it('does NOT override an explicit fontFamily', () => {
    render(<Prim.Text data-testid="x" fontFamily="$mono" fontSize="$sm" />)
    const el = screen.getByTestId('x')
    expect(el).toHaveClass('font_mono', '_fs-f-size-sm')
    expect(el).not.toHaveClass('font_body')
  })

  it('does NOT assign a family when no font-scale token is passed', () => {
    // A primitive with no font props must keep INHERITING its font — that is the whole reason these
    // primitives use the `.is_Text` base rather than `.is_View`.
    render(<Prim.Text data-testid="x" color="$foreground" />)
    expect(screen.getByTestId('x').className).not.toMatch(/font_body|_ff-/)
  })

  it('leaves a raw numeric fontSize alone', () => {
    render(<Prim.Text data-testid="x" fontSize={14} />)
    const el = screen.getByTestId('x')
    expect(el).toHaveClass('_fs-14px')
    expect(el.className).not.toMatch(/font_body/)
  })
})

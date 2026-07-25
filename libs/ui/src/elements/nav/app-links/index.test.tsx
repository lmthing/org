import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { AppLinks } from './index'

/**
 * The shipped `AppLinks`. Replaces the deleted `app-links-styled.test.tsx`, which gated a parallel
 * `styled()` copy nothing imported. See docs/tamagui-idiomatic-migration.md §4/§6.
 *
 * Colour/radius atomic classes are HASHED when the value is a token reference, so they are matched
 * by prefix (`_col-muted-foreg…`) rather than pinned whole.
 */
describe('AppLinks', () => {
  const row = () => screen.getAllByRole('link')[0]!.parentElement!

  it('omits the CURRENT surface from the row', () => {
    render(<AppLinks current="studio" />)
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.length).toBeGreaterThan(0)
    expect(hrefs.some((h) => /\/\/[^/]*studio/.test(h))).toBe(false)
  })

  it('is a padded flex row — the former `.app-links`', () => {
    render(<AppLinks current="studio" />)
    expect(row()).toHaveClass(
      '_dsp-flex', '_alignItems-center', '_gap-c-space-1',
      '_paddingLeft-c-space-3', '_paddingTop-c-space-2',
    )
  })

  it('`bordered` adds the bottom divider (the former `--bordered` modifier)', () => {
    render(<AppLinks current="studio" bordered />)
    expect(row()).toHaveClass('_borderBottomWidth-1px')
    expect(row().className).toMatch(/_borderBottomColor-sidebar-bor/)
  })

  it('is undivided by default', () => {
    render(<AppLinks current="studio" />)
    expect(row().className).not.toMatch(/_borderBottomWidth-1px/)
  })

  it('each link is an equal-width centred muted pill — the former `.app-links__link`', () => {
    render(<AppLinks current="studio" />)
    const link = screen.getAllByRole('link')[0]!
    expect(link).toHaveClass(
      '_dsp-flex', '_alignItems-center', '_justifyContent-center',
      '_flexGrow-1', '_flexShrink-1', '_fs-f-size-xs',
    )
    expect(link.className).toMatch(/_col-muted-foreg/)
  })

  it('the hover state is a PROP, not a `:hover` rule — muted/60 via color-mix', () => {
    render(<AppLinks current="studio" />)
    const link = screen.getAllByRole('link')[0]!
    expect(link.className).toMatch(/_backgroundColor-0hover-color-mix/)
    expect(link.className).toMatch(/_col-0hover-foreground/)
  })
})

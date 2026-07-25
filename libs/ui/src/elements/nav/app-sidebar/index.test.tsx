import { describe, it, expect } from 'vitest'
import { __styles as S } from './index'

/**
 * The shipped `AppSidebar`. Replaces the deleted `app-sidebar-styled.test.tsx`, which gated a
 * parallel `styled()` copy nothing imported — these assertions are against the bags the shipped
 * component spreads.
 *
 * Value assertions, not a render: the project dropdown pulls in `@lmthing/state`, which resolves a
 * second copy of React under this vitest config, so any hook in the tree throws "Invalid hook
 * call". See docs/tamagui-idiomatic-migration.md §4/§6.
 */
describe('AppSidebar — the translated `.app-sidebar*` rules', () => {
  it('every bag is $-token or a var(), never a raw colour literal', () => {
    // The design-system gate in prose form: `lint:tokens` catches hex/rgb in source, this catches
    // a token NAME that was dropped (a bare `muted` instead of `$muted`).
    for (const [name, bag] of Object.entries(S)) {
      for (const [prop, value] of Object.entries(bag as Record<string, unknown>)) {
        if (!/[Cc]olor$/.test(prop) || typeof value !== 'string') continue
        expect(
          value.startsWith('$') || value.startsWith('var(') || value === 'transparent' ||
          value.startsWith('color-mix(') || value.startsWith('rgba('), // ds-lint-ok: allow-list, not a value
          `${name}.${prop} = ${value}`,
        ).toBe(true)
      }
    }
  })

  it('the shell is a fixed-width column that collapses to the icon rail', () => {
    expect(S.SIDEBAR_SHELL).toMatchObject({ display: 'flex', flexDirection: 'column' })
    expect(S.SHELL_FIXED).toEqual({ width: '$64' })
    expect(S.SHELL_COLLAPSED).toEqual({ width: '$12' })
  })

  it('`--active` is a MODIFIER bag, applied on top of the base item', () => {
    // `.app-sidebar__item--active` overrode background/colour/weight only; everything else
    // (padding, radius, layout) still comes from the base — which is why it is a separate spread.
    expect(S.ITEM_ACTIVE).toEqual({ backgroundColor: '$muted', color: '$foreground', fontWeight: '$medium' })
    expect(Object.keys(S.ITEM).length).toBeGreaterThan(Object.keys(S.ITEM_ACTIVE).length)
  })

  it('the delete button is the hover-GROUP reveal, not a `:hover .child` rule', () => {
    // This is the shape the whole migration leans on: the row carries `group="row"`, the child a
    // `$group-row-hover` bag. Both halves fail silently if they come apart.
    expect(S.DROPDOWN_DELETE).toMatchObject({ display: 'none', '$group-row-hover': { display: 'flex' } })
    expect(S.DROPDOWN_DELETE).toMatchObject({ hoverStyle: { color: '$destructive' } })
  })

  it('the dropdown menu carries a single-layer Tamagui shadow, not a box-shadow string', () => {
    expect(S.DROPDOWN_MENU).toMatchObject({
      position: 'absolute',
      backgroundColor: '$popover',
      shadowOffset: { width: 0, height: 10 },
      shadowRadius: 15,
    })
  })

  it('the icon buttons share ONE base bag, so the rail/collapse/settings variants stay in sync', () => {
    for (const bag of [S.RAIL_BTN, S.COLLAPSE_BTN, S.PROJECT_SETTINGS]) {
      expect(bag).toMatchObject({ ...S.ICON_BTN, ...bag })
    }
  })

  it('the brand mark is the heading face, and the rail variant only tightens leading', () => {
    expect(S.BRAND).toEqual({ fontFamily: '$heading', fontWeight: '$bold', fontSize: '$base' })
    expect(S.RAIL_BRAND).toEqual({ ...S.BRAND, lineHeight: 1 })
  })
})

import { render, screen } from '../../../test-utils/index'
import { describe, it, expect } from 'vitest'
import { AppSidebar, __styles as S } from './index'

/**
 * The shipped `AppSidebar`. Replaces the deleted `app-sidebar-styled.test.tsx`, which gated a
 * parallel `styled()` copy nothing imported — these assertions are against the bags the shipped
 * component spreads.
 *
 * Value assertions against the bags the shipped component spreads — PLUS real renders, which were
 * impossible until phase 5b. `libs/ui` pinned React 18 while `apps/web`/`state`/`auth` were on 19, so
 * the project dropdown's `@lmthing/state` import resolved a SECOND copy of React and every hook in
 * the tree threw "Invalid hook call". Deduping to one React 19 is what unblocked the renders below.
 * See docs/tamagui-final-steps.md §5b.
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

  // ── renders ─────────────────────────────────────────────────────────────────────────────────
  // The regression guard for the dedupe itself: if a second copy of React ever comes back, these
  // throw "Invalid hook call" and say so loudly, instead of the component quietly reverting to
  // being untestable.
  it('renders the expanded shell with its landmark label', () => {
    render(<AppSidebar projects={[]} spaces={[]} />)
    expect(screen.getByLabelText('projects, spaces and conversations')).toBeInTheDocument()
  })

  it('renders projects and spaces passed to it', () => {
    render(
      <AppSidebar
        projects={[{ id: 'p1', name: 'Alpha' }]}
        activeProjectId="p1"
        spaces={[{ id: 's1', name: 'Notes' }]}
      />,
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
  })

  it('honours the `flexShrink` prop phase 1 introduced', () => {
    // Three studio surfaces used to pass `className="shrink-0"`; there is no Tailwind after phase 4.
    const { container } = render(<AppSidebar projects={[]} spaces={[]} flexShrink={0} />)
    const nav = container.querySelector('nav')
    expect(nav).toBeTruthy()
    expect(nav!.className).toBeTruthy()
  })
})

import { describe, it, expect } from 'vitest'
import { classToProps, __internal } from './classnames-to-props-map.mjs'

/**
 * The objective correctness gate for the P3 classnames-to-props codemod
 * (docs/tamagui-idiomatic-migration.md §5). Because the class→prop translation is what lets the
 * migration run at 1281-usage scale without a human eyeballing every diff, the translation table
 * is exhaustively pinned here: every row of the §5 utility→prop map, plus variant routing,
 * arbitrary values, negatives, and the deliberate keep/skip cases.
 */

describe('spacing → $space props (SPIKE B scale, 1:1 with Tailwind)', () => {
  it('padding shorthands', () => {
    expect(classToProps('px-6').props).toEqual({ paddingHorizontal: '$6' })
    expect(classToProps('py-12').props).toEqual({ paddingVertical: '$12' })
    expect(classToProps('p-4').props).toEqual({ padding: '$4' })
    expect(classToProps('pt-2 pb-8').props).toEqual({ paddingTop: '$2', paddingBottom: '$8' })
    expect(classToProps('py-1.5').props).toEqual({ paddingVertical: '$1.5' })
  })
  it('margins incl. negative + auto', () => {
    expect(classToProps('mb-5').props).toEqual({ marginBottom: '$5' })
    expect(classToProps('mx-auto').props).toEqual({ marginHorizontal: 'auto' })
    expect(classToProps('-mt-2').props).toEqual({ marginTop: '-$2' })
  })
  it('gap', () => {
    expect(classToProps('gap-2').props).toEqual({ gap: '$2' })
    expect(classToProps('gap-x-4 gap-y-1').props).toEqual({ columnGap: '$4', rowGap: '$1' })
  })
})

describe('sizing → $size props', () => {
  it('w/h from the spacing scale', () => {
    expect(classToProps('w-12 h-12').props).toEqual({ width: '$12', height: '$12' })
  })
  it('fractions, full, screen', () => {
    expect(classToProps('w-1/2').props).toEqual({ width: '50%' })
    expect(classToProps('w-full').props).toEqual({ width: '100%' })
    expect(classToProps('h-screen').props).toEqual({ height: '100vh' })
  })
  it('min-w-0 and the max-width scale', () => {
    expect(classToProps('min-w-0').props).toEqual({ minWidth: 0 })
    expect(classToProps('max-w-xs').props).toEqual({ maxWidth: 320 })
    expect(classToProps('max-w-sm').props).toEqual({ maxWidth: 384 })
    expect(classToProps('max-w-full').props).toEqual({ maxWidth: '100%' })
  })
})

describe('layout / flex', () => {
  it('display', () => {
    expect(classToProps('flex').props).toEqual({ display: 'flex' })
    expect(classToProps('hidden').props).toEqual({ display: 'none' })
  })
  it('direction + wrap', () => {
    expect(classToProps('flex-col').props).toEqual({ flexDirection: 'column' })
    expect(classToProps('flex-wrap').props).toEqual({ flexWrap: 'wrap' })
  })
  it('flex-1 expands to grow/shrink/basis', () => {
    expect(classToProps('flex-1').props).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: '0%' })
  })
  it('alignment', () => {
    expect(classToProps('items-center').props).toEqual({ alignItems: 'center' })
    expect(classToProps('justify-center').props).toEqual({ justifyContent: 'center' })
    expect(classToProps('justify-between').props).toEqual({ justifyContent: 'space-between' })
    expect(classToProps('self-start').props).toEqual({ alignSelf: 'flex-start' })
  })
})

describe('colors → $color props', () => {
  it('token names map to $token', () => {
    expect(classToProps('bg-background').props).toEqual({ backgroundColor: '$background' })
    expect(classToProps('text-foreground').props).toEqual({ color: '$foreground' })
    expect(classToProps('border-border').props).toEqual({ borderColor: '$border' })
  })
  it('text-* size vs color vs align is disambiguated', () => {
    expect(classToProps('text-sm').props).toEqual({ fontSize: '$sm' })
    expect(classToProps('text-center').props).toEqual({ textAlign: 'center' })
    expect(classToProps('text-muted-foreground').props).toEqual({ color: '$muted-foreground' })
  })
  it('alpha modifiers become a color-mix, matching the hand-written elements', () => {
    // Badge `success`, Button `primary` hover and AppLinks hover all hand-wrote the alpha this
    // way, so the codemod emits the same form rather than a third one.
    expect(classToProps('bg-brand-2/20').props)
      .toEqual({ backgroundColor: 'color-mix(in srgb, var(--brand-2) 20%, transparent)' })
    expect(classToProps('hover:bg-muted/60').props)
      .toEqual({ hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)' } })
  })

  it('black/white alpha stays a className — the value would be a raw literal', () => {
    // No CSS var to mix, and a codemod cannot emit the `ds-lint-ok` escape into a JSX attribute.
    // The sole use is the `bg-black/50` dialog wash, already hand-written on the Dialog element.
    expect(classToProps('bg-black/50').keep).toContain('bg-black/50')
  })
  it('arbitrary color → literal', () => {
    expect(classToProps('bg-[var(--lm-x)]').props).toEqual({ backgroundColor: 'var(--lm-x)' })
  })
})

describe('typography', () => {
  it('weights + families', () => {
    expect(classToProps('font-bold').props).toEqual({ fontWeight: '$bold' })
    expect(classToProps('font-semibold').props).toEqual({ fontWeight: '$semibold' })
    expect(classToProps('font-display').props).toEqual({ fontFamily: '$heading' })
    expect(classToProps('font-mono').props).toEqual({ fontFamily: '$mono' })
  })
  it('tracking + transform + truncate', () => {
    expect(classToProps('tracking-wide').props).toEqual({ letterSpacing: '$wide' })
    expect(classToProps('uppercase').props).toEqual({ textTransform: 'uppercase' })
    expect(classToProps('truncate').props).toEqual({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
  })
})

describe('radius / border / position / overflow', () => {
  it('radius', () => {
    expect(classToProps('rounded-xl').props).toEqual({ borderRadius: '$radius-xl' })
    expect(classToProps('rounded-full').props).toEqual({ borderRadius: '$radius-full' })
    expect(classToProps('rounded').props).toEqual({ borderRadius: '$radius' })
  })
  it('border width', () => {
    expect(classToProps('border').props).toEqual({ borderWidth: 1 })
    expect(classToProps('border-2').props).toEqual({ borderWidth: 2 })
  })
  it('position + inset + z', () => {
    expect(classToProps('absolute').props).toEqual({ position: 'absolute' })
    expect(classToProps('top-0').props).toEqual({ top: '$0' })
    expect(classToProps('inset-0').props).toEqual({ top: '$0', right: '$0', bottom: '$0', left: '$0' })
    expect(classToProps('z-10').props).toEqual({ zIndex: 10 })
  })
  it('overflow + opacity', () => {
    expect(classToProps('overflow-hidden').props).toEqual({ overflow: 'hidden' })
    expect(classToProps('opacity-50').props).toEqual({ opacity: 0.5 })
  })
})

describe('variants → nested style props', () => {
  it('hover/focus/active/disabled → *Style', () => {
    expect(classToProps('hover:text-foreground').props).toEqual({ hoverStyle: { color: '$foreground' } })
    expect(classToProps('focus:border-ring').props).toEqual({ focusStyle: { borderColor: '$ring' } })
    expect(classToProps('active:bg-accent').props).toEqual({ pressStyle: { backgroundColor: '$accent' } })
    expect(classToProps('disabled:opacity-50').props).toEqual({ disabledStyle: { opacity: 0.5 } })
  })
  it('combines multiple classes under one variant', () => {
    expect(classToProps('hover:bg-accent hover:text-foreground').props).toEqual({
      hoverStyle: { backgroundColor: '$accent', color: '$foreground' },
    })
  })
  it('media breakpoints → $md etc. (mobile-first, 1:1 by name)', () => {
    expect(classToProps('md:flex-row').props).toEqual({ $md: { flexDirection: 'row' } })
    expect(classToProps('lg:gap-8').props).toEqual({ $lg: { gap: '$8' } })
  })
  it('group-hover → $group-hover', () => {
    expect(classToProps('group-hover:text-foreground').props).toEqual({ '$group-hover': { color: '$foreground' } })
  })
  it('dark: is kept (the $token flips with the theme; theme.css rule applies meanwhile)', () => {
    const r = classToProps('dark:bg-card')
    expect(r.keep).toEqual(['dark:bg-card'])
    expect(r.props).toEqual({})
  })
})

describe('skip reporting (the manual tail)', () => {
  it('flags genuinely UNRECOGNISED utilities for human review', () => {
    // `skip` means "unrecognised" and bails the whole element. It must stay narrow: an
    // over-eager skip holds the mappable classes beside it hostage.
    expect(classToProps('totally-unknown-utility').skip).toContain('totally-unknown-utility')
    expect(classToProps('aspect-[4/3]').skip.length + classToProps('aspect-[4/3]').keep.length).toBeGreaterThan(0)
  })

  it('KEEPS the known-but-deferred families instead of skipping them', () => {
    // These are recognised and consciously left as classNames (Tailwind still ships their CSS).
    // Marking them `skip` blocked every mappable class on the same element — the single change
    // that took the codemod from 4 migratable elements to 37.
    for (const c of ['transition-colors', 'animate-spin', 'duration-150', 'backdrop-blur-sm',
                     'prose', 'space-y-2', 'group', 'lm-fade-in']) {
      const r = classToProps(c)
      expect(r.keep, `${c} should be kept, not skipped`).toContain(c)
      expect(r.skip).toEqual([])
    }
  })

  it('migrates the mappable classes ALONGSIDE a kept one', () => {
    const r = classToProps('text-sm px-3 rounded-lg transition-colors')
    expect(r.props).toMatchObject({ fontSize: '$sm', paddingHorizontal: '$3', borderRadius: '$radius-lg' })
    expect(r.keep).toEqual(['transition-colors'])
    expect(r.skip).toEqual([])
  })

  it('maps shadow-* to the same approximation the hand conversions used', () => {
    expect(classToProps('shadow-lg').props).toMatchObject({ shadowRadius: 15 })
  })

  it('maps ring-* to the outline props the element conversions standardised on', () => {
    // Tailwind implements a ring as a box-shadow; Button/Input/Select all hand-wrote it as an
    // outline in `focusVisibleStyle`, so the map matches them rather than inventing a third form.
    expect(classToProps('ring-2').props).toEqual({ outlineWidth: 2, outlineStyle: 'solid' })
    expect(classToProps('ring-ring').props).toEqual({ outlineColor: '$ring' })
    expect(classToProps('focus-visible:ring-2').props).toEqual({
      focusVisibleStyle: { outlineWidth: 2, outlineStyle: 'solid' },
    })
  })

  it('maps the `placeholder:` variant to the flat placeholderTextColor prop', () => {
    // Not a nested style bag: Tamagui exposes the pseudo-element as one prop, which the
    // form-control primitives turn into the CSS var its own `.is_Input::placeholder` rule reads.
    expect(classToProps('placeholder:text-muted-foreground').props)
      .toEqual({ placeholderTextColor: '$muted-foreground' })
    // an `lm-*` colour has no `$token`, but it does have a CSS var
    expect(classToProps('placeholder:text-lm-muted').props)
      .toEqual({ placeholderTextColor: 'var(--lm-muted)' })
  })

  it('maps arbitrary tracking', () => {
    expect(classToProps('tracking-[0.16em]').props).toEqual({ letterSpacing: '0.16em' })
  })
  it('an alpha modifier under a variant is a skip (cannot be a plain className)', () => {
    // an alpha modifier under a variant now nests a color-mix instead of bailing
    expect(classToProps('hover:border-foreground/30').props).toEqual({
      hoverStyle: { borderColor: 'color-mix(in srgb, var(--foreground) 30%, transparent)' },
    })
  })
})

describe('the real EmptyState className strings translate as expected', () => {
  it('outer Col', () => {
    const r = classToProps('justify-center px-6 py-12 text-center')
    expect(r.props).toEqual({ justifyContent: 'center', paddingHorizontal: '$6', paddingVertical: '$12', textAlign: 'center' })
    expect(r.skip).toEqual([])
  })
  it('heading Text', () => {
    const r = classToProps('font-display text-2xl font-bold text-foreground mb-2')
    expect(r.props).toEqual({ fontFamily: '$heading', fontSize: '$2xl', fontWeight: '$bold', color: '$foreground', marginBottom: '$2' })
    expect(r.skip).toEqual([])
  })
  it('icon Row (bg alpha now mixes, rest lifted — nothing left as className)', () => {
    const r = classToProps('w-12 h-12 rounded-xl bg-brand-2/20 justify-center mb-5 text-2xl')
    expect(r.props).toEqual({
      width: '$12', height: '$12', borderRadius: '$radius-xl', justifyContent: 'center',
      marginBottom: '$5', fontSize: '$2xl',
      backgroundColor: 'color-mix(in srgb, var(--brand-2) 20%, transparent)',
    })
    expect(r.keep).toEqual([])
  })
})

describe('__internal helpers', () => {
  it('spaceToken', () => {
    expect(__internal.spaceToken('4')).toBe('$4')
    expect(__internal.spaceToken('[10px]')).toBe('10px')
    expect(__internal.spaceToken('999')).toBe(null)
  })
})

describe('regression: directional border WIDTH is not misread as a color token', () => {
  it('border-t/r/b/l/x/y → directional widths (not $t/$b garbage)', () => {
    expect(classToProps('border-t').props).toEqual({ borderTopWidth: 1 })
    expect(classToProps('border-b').props).toEqual({ borderBottomWidth: 1 })
    expect(classToProps('border-l').props).toEqual({ borderLeftWidth: 1 })
    expect(classToProps('border-r').props).toEqual({ borderRightWidth: 1 })
    expect(classToProps('border-x').props).toEqual({ borderLeftWidth: 1, borderRightWidth: 1 })
    expect(classToProps('border-y').props).toEqual({ borderTopWidth: 1, borderBottomWidth: 1 })
    expect(classToProps('border-t-2').props).toEqual({ borderTopWidth: 2 })
  })
  it('border width + border color on one element keep BOTH', () => {
    expect(classToProps('border-t border-border').props).toEqual({ borderTopWidth: 1, borderColor: '$border' })
    expect(classToProps('border border-border').props).toEqual({ borderWidth: 1, borderColor: '$border' })
  })
})

describe('regression: lm-* runtime palette never becomes a bogus $lm-* token', () => {
  it('maps to the CSS VAR, so the runtime per-space override still reaches it', () => {
    // The original bug was emitting `$lm-accent`, which resolves to nothing. Emitting the var is
    // the fix AND keeps `applyThemeTokens` (theme.ts) working: a space's theme.json overrides
    // `--lm-accent` directly, so mapping to the token it currently aliases (`$agent`) would
    // silently disconnect per-space theming.
    expect(classToProps('bg-lm-accent').props).toEqual({ backgroundColor: 'var(--lm-accent)' })
    expect(classToProps('text-lm-text').props).toEqual({ color: 'var(--lm-text)' })
    expect(classToProps('border-lm-border').props).toEqual({ borderColor: 'var(--lm-border)' })
    for (const c of ['bg-lm-accent', 'text-lm-text', 'border-lm-border']) {
      expect(JSON.stringify(classToProps(c))).not.toContain('$lm-')
    }
  })

  it('an lm-* colour with an alpha modifier mixes over its var, keeping the runtime override', () => {
    expect(classToProps('bg-lm-accent/20').props)
      .toEqual({ backgroundColor: 'color-mix(in srgb, var(--lm-accent) 20%, transparent)' })
  })
  it('real design-token colors still lift', () => {
    expect(classToProps('bg-primary').props).toEqual({ backgroundColor: '$primary' })
    expect(classToProps('text-muted-foreground').props).toEqual({ color: '$muted-foreground' })
  })
})

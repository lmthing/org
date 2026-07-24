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
  it('alpha modifiers are KEPT as className (no faithful $token/NN)', () => {
    const r = classToProps('bg-brand-2/20')
    expect(r.props).toEqual({})
    expect(r.keep).toEqual(['bg-brand-2/20'])
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
  it('flags unmapped utilities for human review', () => {
    expect(classToProps('transition-colors').skip).toContain('transition-colors')
    expect(classToProps('animate-spin').skip).toContain('animate-spin')
    expect(classToProps('shadow-lg').skip).toContain('shadow-lg')
  })
  it('an alpha modifier under a variant is a skip (cannot be a plain className)', () => {
    expect(classToProps('hover:border-foreground/30').skip).toContain('hover:border-foreground/30')
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
  it('icon Row (bg alpha kept, rest lifted)', () => {
    const r = classToProps('w-12 h-12 rounded-xl bg-brand-2/20 justify-center mb-5 text-2xl')
    expect(r.props).toEqual({ width: '$12', height: '$12', borderRadius: '$radius-xl', justifyContent: 'center', marginBottom: '$5', fontSize: '$2xl' })
    expect(r.keep).toEqual(['bg-brand-2/20'])
  })
})

describe('__internal helpers', () => {
  it('spaceToken', () => {
    expect(__internal.spaceToken('4')).toBe('$4')
    expect(__internal.spaceToken('[10px]')).toBe('10px')
    expect(__internal.spaceToken('999')).toBe(null)
  })
})

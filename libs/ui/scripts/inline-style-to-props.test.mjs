import { describe, it, expect } from 'vitest'
import { transform, pairToProps } from './inline-style-to-props.mjs'

/**
 * Gate for the inline-`style` → props codemod (docs/tamagui-idiomatic-migration.md §5). `style` is
 * the bigger of the two escape hatches: it bypasses Tamagui's atomic CSS entirely, so a value there
 * gets no variants, no token resolution and no native translation.
 */
const run = (src) => transform('libs/ui/src/x.tsx', src)

describe('pairToProps', () => {
  it('lifts the direct keys', () => {
    expect(pairToProps('display', 'flex')).toEqual({ display: 'flex' })
    expect(pairToProps('gap', '0.5rem')).toEqual({ gap: '0.5rem' })
    expect(pairToProps('zIndex', 50)).toEqual({ zIndex: 50 })
  })

  it('EXPANDS the shorthands Tamagui has no prop for', () => {
    expect(pairToProps('flex', 1)).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: '0%' })
    expect(pairToProps('padding', '0.5rem 1rem')).toEqual({ paddingVertical: '0.5rem', paddingHorizontal: '1rem' })
    expect(pairToProps('margin', '1px 2px 3px 4px'))
      .toEqual({ marginTop: '1px', marginRight: '2px', marginBottom: '3px', marginLeft: '4px' })
    expect(pairToProps('border', '1px solid var(--border)'))
      .toEqual({ borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)' })
    expect(pairToProps('borderBottom', '2px solid var(--border)'))
      .toEqual({ borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' })
    expect(pairToProps('background', 'var(--muted)')).toEqual({ backgroundColor: 'var(--muted)' })
    expect(pairToProps('background', 'linear-gradient(red, blue)')).toEqual({ backgroundImage: 'linear-gradient(red, blue)' })
    // `outline: none` — the form this codebase already writes by hand
    // (`elements/overlays/dropdown/index.tsx`). Adding it unblocked `CatalogForm`'s `inputStyle`,
    // whose 12 call sites were held hostage by this one key.
    expect(pairToProps('outline', 'none')).toEqual({ outlineWidth: 0, outlineStyle: 'none' })
  })

  it('accepts the outline LONGHANDS, which map 1:1', () => {
    expect(pairToProps('outlineWidth', 2)).toEqual({ outlineWidth: 2 })
    expect(pairToProps('outlineStyle', 'solid')).toEqual({ outlineStyle: 'solid' })
    expect(pairToProps('outlineColor', 'var(--ring)')).toEqual({ outlineColor: 'var(--ring)' })
  })

  it('REFUSES the keys Tamagui silently drops', () => {
    // Verified against a real render in `primitives/index.test.tsx`: these emit no atomic class at
    // all, so lifting them out of `style` would delete the paint.
    for (const k of ['wordBreak', 'listStyleType', 'listStyle']) {
      expect(pairToProps(k, 'x'), k).toBeNull()
    }
  })

  it('refuses what needs thought rather than guessing', () => {
    expect(pairToProps('transition', 'all 0.2s')).toBeNull()
    expect(pairToProps('boxShadow', '0 1px 2px red')).toBeNull()
    expect(pairToProps('font', '12px monospace')).toBeNull()
    expect(pairToProps('flex', '2 1 auto')).toBeNull() // only `flex: 1` has a safe expansion
    // Only `outline: none` expands. Anything else mixes width/style/colour and needs a human — a
    // wrong guess here silently removes or invents a focus ring.
    expect(pairToProps('outline', '2px solid red')).toBeNull()
    expect(pairToProps('outline', '0')).toBeNull()
  })
})

describe('transform', () => {
  it('lifts a whole static object onto the element', () => {
    const { text } = run(`export const A = () => <Prim.Box style={{ display: 'flex', gap: '0.5rem' }} />`)
    expect(text).toContain('<Prim.Box display="flex" gap="0.5rem" />')
    expect(text).not.toContain('style=')
  })

  it('keeps a non-literal VALUE as an expression — only the KEY set has to be understood', () => {
    const { text } = run(`export const A = () => <Prim.Box style={{ color: colors.brand, width: w }} />`)
    expect(text).toContain('color={colors.brand}')
    expect(text).toContain('width={w}')
  })

  it('bails the WHOLE object on one unknown key, never half-lifting', () => {
    const src = `export const A = () => <Prim.Box style={{ display: 'flex', boxShadow: '0 0 1px red' }} />`
    const r = run(src)
    expect(r.changed).toBe(false)
    expect(r.skips).toHaveLength(1)
    expect(r.skips[0].why).toContain('boxShadow')
  })

  it('bails on a spread, which could carry anything', () => {
    const r = run(`export const A = () => <Prim.Box style={{ ...base, gap: '1rem' }} />`)
    expect(r.changed).toBe(false)
    expect(r.skips[0].why).toContain('spread')
  })

  it('reports a collision instead of emitting a duplicate prop', () => {
    const r = run(`export const A = () => <Prim.Box gap="$2" style={{ gap: '1rem' }} />`)
    expect(r.changed).toBe(false)
    expect(r.skips[0].why).toContain('already sets gap')
  })

  it('leaves NON-Tamagui elements alone — a passthrough ignores style props', () => {
    // `Prim.Svg` forwards to a raw `<svg>`; lifting its style would delete it.
    expect(run(`export const A = () => <Prim.Svg style={{ width: 16 }} />`).changed).toBe(false)
    expect(run(`export const A = () => <Icon style={{ width: 16 }} />`).changed).toBe(false)
  })
})

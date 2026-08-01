/**
 * The WORDMARK, rendered on the React Native target.
 *
 * The mark is a `Prim.Text` wrapper (which names the brand face) around one `Prim.Text` per letter
 * (which names only its `$logo-N` colour). On web the letters are `<span>`s and INHERIT
 * `font-family`; the jsdom test asserts `font_brand` on the wrapper and that is the whole story
 * there.
 *
 * **On native it is not.** `primitives/_native.tsx#NativeText` sets `fontFamily: '$body'` as a
 * styled default — it must, or a `$`-token `fontSize` has no scale to resolve against and Tamagui
 * drops it silently. A styled default is unconditional, so it lands on each letter as an EXPLICIT
 * family and beats the wrapper's. Measured on an emulator: every letter rendered in Manrope Regular
 * while the wrapper truthfully carried `font_brand`, so the mark was the wrong typeface AND the
 * wrong weight on every mobile surface. The letter colours were right, which is what made it read as
 * a rendering glitch rather than as a bug.
 *
 * These assertions are on the LETTERS, because the wrapper was never what was broken.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, flattenStyle, NATIVE_TEXT } from '../render'
import { CozyThingText } from '../../src/elements/branding/cozy-text'

/** The one face `--font-brand` ships (`tokens.json`), as `NATIVE_FACE` resolves every weight to it. */
const BRAND_FACE = 'TypeMates Cera Round Pro Bold'
/** What the letters rendered in while the bug was live — the exact wrong answer, named. */
const BODY_FACE = 'Manrope'

/** Every native text node the mark produced, wrapper included, with its flattened style. */
const markStyles = (element: React.ReactElement) => {
  const { tree } = render(element)
  return findAll(tree, (type) => type === NATIVE_TEXT).map((node) => flattenStyle(node.props?.style))
}

test('every letter of the wordmark renders in the brand face, not the UI face', () => {
  const styles = markStyles(<CozyThingText text="lmthing" />)
  // l·m + t·h·i·n·g is 6 coloured runs plus the wrapper — if this drops to 1 the mark stopped
  // being per-letter and these assertions would pass while proving nothing.
  expect(styles.length > 1).toBe(true)
  // `toBe(BRAND_FACE)` already excludes `BODY_FACE`; naming it keeps the regression legible when
  // this fails, since Manrope is the exact value the bug produced. (The harness `expect` has no
  // `.not`, so this is an assertion on the whole set rather than a negation per node.)
  expect(styles.map((s) => s.fontFamily).filter((f) => f === BODY_FACE)).toEqual([])
  for (const style of styles) expect(style.fontFamily).toBe(BRAND_FACE)
})

test('the letters keep their own $logo colours while sharing the face', () => {
  const styles = markStyles(<CozyThingText text="lmthing" />)
  const colors = styles.map((s) => s.color).filter((c) => typeof c === 'string')
  // The five `thing` hues plus the neutral `lm` — resolved to literals, since native has no vars.
  expect(new Set(colors).size >= 5).toBe(true)
  for (const color of colors) expect(String(color).startsWith('var(')).toBe(false)
})

test('a caller that restyles the mark restyles its letters too', () => {
  // `elements/nav/app-sidebar` restyles the mark with plain style props. If only the wrapper picked
  // the override up, the letters would silently keep the default face — the same split this suite
  // exists to catch, just with the roles reversed.
  const styles = markStyles(<CozyThingText text="thing" fontFamily="$mono" />)
  for (const style of styles) expect(style.fontFamily).toBe('JetBrains Mono')
})

test('the suffix form (lmthing.store) is the brand face throughout', () => {
  const styles = markStyles(<CozyThingText text="lmthing.store" />)
  expect(styles.length > 1).toBe(true)
  for (const style of styles) expect(style.fontFamily).toBe(BRAND_FACE)
})

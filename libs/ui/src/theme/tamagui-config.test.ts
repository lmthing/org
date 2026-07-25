import { describe, it, expect } from 'vitest'
import { tamaguiConfig, buildThemes, buildColorTokens, buildRadiusTokens, cssLengthToNative } from './tamagui.config'
import {
  themes as genThemes,
  radius as genRadius,
  fonts as genFonts,
  space as genSpace,
  size as genSize,
  fontSizes as genFontSizes,
  fontWeights as genFontWeights,
  letterSpacings as genLetterSpacings,
  zIndex as genZIndex,
} from '@lmthing/css/tamagui-tokens'

/**
 * The NATIVE theme pair. Since phase 5a there is ONE config, and its `themes` are chosen by `isWeb` —
 * which is always true under jsdom, so `tamaguiConfig.themes` here is the single empty `app` theme.
 * The native branch is reached through the pure builder instead, so these assertions keep running
 * rather than silently evaporating when the configs merged.
 */
const NATIVE_THEMES = buildThemes(false)

/**
 * Layer-1 (runtime) parity for the buildable Tamagui config shell.
 *
 * The pure-data token module (`@lmthing/css/tamagui-tokens`) is already proven byte-identical to
 * `theme.css` by libs/css's token-parity test. THIS test proves the runtime `createTamagui`
 * config (`tamagui.config.ts`) carries those exact values through into `config.themes` — i.e.
 * the shell does not mutate, round, or drop a single token on the way into Tamagui. Together the
 * two guarantee: tokens.json === theme.css === tamagui.config, byte-for-byte.
 *
 * See docs/react-native-tamagui-migration.md §5.
 */

// createTamagui stores each theme value as a variable object ({ val, ... }) on web, or the raw
// string in some builds — normalize to the underlying value for an exact string comparison.
const val = (v: unknown): string =>
  typeof v === 'object' && v !== null && 'val' in v ? String((v as { val: unknown }).val) : String(v)

describe('tamagui.config createTamagui shell', () => {
  it('constructs with both themes', () => {
    expect(tamaguiConfig).toBeTruthy()
    expect(NATIVE_THEMES.light).toBeTruthy()
    expect(NATIVE_THEMES.dark).toBeTruthy()
  })

  it('light theme values equal the generated (theme.css-parity) tokens byte-for-byte', () => {
    for (const [name, expected] of Object.entries(genThemes.light)) {
      expect(val(NATIVE_THEMES.light[name]), `light.${name}`).toBe(expected)
    }
  })

  it('dark theme values equal the generated (theme.css-parity) tokens byte-for-byte', () => {
    for (const [name, expected] of Object.entries(genThemes.dark)) {
      expect(val(NATIVE_THEMES.dark[name]), `dark.${name}`).toBe(expected)
    }
  })

  it('exposes every design-token color name in both themes (no dropped tokens)', () => {
    const names = Object.keys(genThemes.light)
    expect(names.length).toBeGreaterThan(90)
    for (const name of names) {
      expect(NATIVE_THEMES.light, `light missing ${name}`).toHaveProperty(name)
      expect(NATIVE_THEMES.dark, `dark missing ${name}`).toHaveProperty(name)
    }
  })

  it('radius + font tokens are carried through verbatim', () => {
    for (const [name, expected] of Object.entries(genRadius)) {
      expect(val(tamaguiConfig.tokens.radius[name]), `radius.${name}`).toBe(expected)
    }
    // font families land on the font faces (body=sans, heading=display, mono=mono)
    expect(tamaguiConfig.fonts.body.family).toBeTruthy()
    expect(val(tamaguiConfig.fonts.body.family)).toBe(genFonts['font-sans'])
    expect(val(tamaguiConfig.fonts.heading.family)).toBe(genFonts['font-display'])
    expect(val(tamaguiConfig.fonts.mono.family)).toBe(genFonts['font-mono'])
  })

  it('carries the Tailwind-parity space + size scale (SPIKE B)', () => {
    for (const [name, expected] of Object.entries(genSpace)) {
      expect(val(tamaguiConfig.tokens.space[name]), `space.${name}`).toBe(String(expected))
    }
    for (const [name, expected] of Object.entries(genSize)) {
      expect(val(tamaguiConfig.tokens.size[name]), `size.${name}`).toBe(String(expected))
    }
    // The load-bearing 1:1 mapping the codemod relies on.
    expect(val(tamaguiConfig.tokens.space['4'])).toBe('16')
    expect(val(tamaguiConfig.tokens.space['2'])).toBe('8')
  })

  it('carries the named z-index overlay scale', () => {
    for (const [name, expected] of Object.entries(genZIndex)) {
      expect(val(tamaguiConfig.tokens.zIndex[name]), `zIndex.${name}`).toBe(String(expected))
    }
  })

  it('font faces carry the Tailwind type ramp + weights (SPIKE B)', () => {
    // `$sm`/`$base` sizes and `$semibold`/`$bold` weights land on the body face.
    for (const [name, expected] of Object.entries(genFontSizes)) {
      expect(val(tamaguiConfig.fonts.body.size[name]), `body.size.${name}`).toBe(String(expected))
    }
    for (const [name, expected] of Object.entries(genFontWeights)) {
      expect(val(tamaguiConfig.fonts.body.weight[name]), `body.weight.${name}`).toBe(expected)
    }
  })

  it('carries the tracking ramp as em STRINGS, which Tamagui types as number-only', () => {
    // `GenericFont['letterSpacing']` is typed `number | Variable`, so the config assigns it through
    // a cast. That cast is only safe because the runtime genuinely keeps the `em` string — this is
    // what guards it. Tailwind's `tracking-*` ramp is em-relative; converting to px would break it
    // at every font size.
    for (const [name, expected] of Object.entries(genLetterSpacings)) {
      expect(val(tamaguiConfig.fonts.body.letterSpacing![name]), `body.letterSpacing.${name}`)
        .toBe(expected)
    }
    expect(String(val(tamaguiConfig.fonts.body.letterSpacing!.tight))).toMatch(/em$/)
  })

  it('registers the Tailwind breakpoint media config', () => {
    expect(tamaguiConfig.media).toBeTruthy()
    expect(tamaguiConfig.media.md).toEqual({ minWidth: 768 })
    expect(tamaguiConfig.media.gtSm).toEqual({ minWidth: 768 })
  })

  // ── the platform split (phase 5a) ──────────────────────────────────────────────────────────
  it('web gets ONE EMPTY theme — a coloured pair would override theme.css in dark mode', () => {
    // The bug this guards is in `.issues` history: a `light`/`dark` Tamagui theme injects
    // `.t_light`-scoped custom properties that beat theme.css. Colours must arrive via var-backed
    // TOKENS, never an injected theme. Merging the configs put this one boolean away.
    const web = buildThemes(true)
    expect(Object.keys(web)).toEqual(['app'])
    expect(web.app).toEqual({})
  })

  it('web radius tokens are CSS strings; native ones are numbers of dp', () => {
    const web = buildRadiusTokens(true)
    const native = buildRadiusTokens(false)
    // Web parity is byte-exact — this is what makes `$radius-lg` equal `--radius-lg`.
    for (const [name, expected] of Object.entries(genRadius)) expect(web[name], name).toBe(expected)
    // Native has no `rem`: RN takes border radii as numbers, and a string reaches the view as an
    // unusable value nothing on web can observe. 0.5rem === 8dp.
    for (const [name, value] of Object.entries(native)) {
      expect(typeof value, `radius.${name} must be a number on native, got ${String(value)}`).toBe('number')
    }
    expect(native['radius-lg']).toBe(8)
    expect(native['radius-sm']).toBe(2)
    expect(native['radius-full']).toBe(9999)
    // Same key set either way — a token present on one platform and not the other is a silent gap.
    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort())
    // The `true` alias tracks radius-md on both.
    expect(web.true).toBe(web['radius-md'])
    expect(native.true).toBe(native['radius-md'])
  })

  it('cssLengthToNative refuses a unit it cannot express rather than returning NaN', () => {
    expect(cssLengthToNative('0.375rem')).toBe(6)
    expect(cssLengthToNative('9999px')).toBe(9999)
    expect(cssLengthToNative('0')).toBe(0)
    // A silently-NaN radius is invisible on screen, which is exactly why this throws.
    expect(() => cssLengthToNative('50%')).toThrow()
    expect(() => cssLengthToNative('1em')).toThrow()
  })

  it('web colour tokens are var(--…)-backed; native ones are resolved hex', () => {
    const web = buildColorTokens(true)
    const native = buildColorTokens(false)
    // SPIKE A1: the indirection is what lets a runtime space override retheme the app.
    expect(web['background']).toBe('var(--background)')
    expect(web['agent']).toBe('var(--agent)')
    // Native has no CSS variables, so it must be a literal.
    expect(native['background']).toBe(val(genThemes.light['background']))
    expect(native['background']).not.toContain('var(')
    // Same key set either way — a token present on one platform and not the other is a silent gap.
    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort())
  })
})

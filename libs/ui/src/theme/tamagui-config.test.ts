import { describe, it, expect } from 'vitest'
import { tamaguiConfig } from './tamagui.config'
import {
  themes as genThemes,
  radius as genRadius,
  fonts as genFonts,
  space as genSpace,
  size as genSize,
  fontSizes as genFontSizes,
  fontWeights as genFontWeights,
  zIndex as genZIndex,
} from '@lmthing/css/tamagui-tokens'

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
    expect(tamaguiConfig.themes.light).toBeTruthy()
    expect(tamaguiConfig.themes.dark).toBeTruthy()
  })

  it('light theme values equal the generated (theme.css-parity) tokens byte-for-byte', () => {
    for (const [name, expected] of Object.entries(genThemes.light)) {
      expect(val(tamaguiConfig.themes.light[name]), `light.${name}`).toBe(expected)
    }
  })

  it('dark theme values equal the generated (theme.css-parity) tokens byte-for-byte', () => {
    for (const [name, expected] of Object.entries(genThemes.dark)) {
      expect(val(tamaguiConfig.themes.dark[name]), `dark.${name}`).toBe(expected)
    }
  })

  it('exposes every design-token color name in both themes (no dropped tokens)', () => {
    const names = Object.keys(genThemes.light)
    expect(names.length).toBeGreaterThan(90)
    for (const name of names) {
      expect(tamaguiConfig.themes.light, `light missing ${name}`).toHaveProperty(name)
      expect(tamaguiConfig.themes.dark, `dark missing ${name}`).toHaveProperty(name)
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

  it('registers the Tailwind breakpoint media config', () => {
    expect(tamaguiConfig.media).toBeTruthy()
    expect(tamaguiConfig.media.md).toEqual({ minWidth: 768 })
    expect(tamaguiConfig.media.gtSm).toEqual({ minWidth: 768 })
  })
})

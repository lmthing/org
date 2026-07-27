/**
 * The shared `tamagui.config` with `isWeb === false` — the branch web CI can only simulate.
 *
 * `src/theme/tamagui-config.test.ts` parameterises `buildColorTokens(web)` / `buildThemes(web)`
 * precisely because jsdom forces `isWeb === true`, so the native branch is exercised as a FUNCTION
 * there but never as the config the app actually gets. Here it is the real thing: Metro resolved
 * `@tamagui/core` through its `react-native` export condition, so `isWeb` is genuinely false and
 * `tamaguiConfig` is the object a device would build.
 */
import { isWeb } from '@tamagui/core'
import { test, expect } from '../harness'
import { tamaguiConfig } from '../../src/theme/tamagui.config'

test('Metro resolves @tamagui/core to its native build (isWeb === false)', () => {
  expect(isWeb).toBe(false)
})

test('the native branch builds the light/dark theme pair', () => {
  const names = Object.keys(tamaguiConfig.themes)
  expect(names).toContain('light')
  expect(names).toContain('dark')
})

test('native color tokens are resolved values, never CSS var() indirection', () => {
  const values = Object.values(tamaguiConfig.tokens.color as Record<string, { val?: unknown }>)
  expect(values.length > 0).toBe(true)
  const cssVars = values.filter((token) => String(token?.val ?? token).startsWith('var('))
  // `var(--…)` is the WEB branch (SPIKE A1): it lets runtime space themes re-point a token. There
  // are no CSS variables on native, so a leaked `var()` renders as a broken color, silently.
  expect(cssVars).toHaveLength(0)
})

test('radius tokens arrive as numbers of dp, not CSS rem strings', () => {
  // The web scale is `"0.375rem"`/`"9999px"` so its output equals `--radius-*`. React Native takes
  // radii as numbers and cannot resolve a `rem`; before `buildRadiusTokens` split the branch, every
  // native corner was styled with a string. A jsdom test can check the BUILDER either way — only
  // here is it the config the app actually gets.
  const radius = tamaguiConfig.tokens.radius as Record<string, { val?: unknown }>
  for (const [name, token] of Object.entries(radius)) {
    const value = token?.val ?? token
    if (typeof value !== 'number')
      throw new Error(`radius.${name} is ${JSON.stringify(value)} — RN needs a number of dp`)
  }
  expect((radius['radius-lg']?.val ?? radius['radius-lg']) as number).toBe(8)
})

test('the Tailwind-parity space scale survives onto native ($4 === 16px)', () => {
  // Tamagui strips the `$` when it keys the token table; the VARIABLE it holds keeps `$4` as its
  // key and carries the resolved number.
  const space = tamaguiConfig.tokens.space as Record<string, { key: string; val: unknown }>
  expect(space['4'].key).toBe('$4')
  expect(space['4'].val).toBe(16)
})

test('letterSpacing arrives as numbers of points, not CSS em strings', () => {
  // Tailwind's `tracking-*` ramp is em-relative, which React Native has no unit for: `letterSpacing`
  // is a number of points, and Android's view manager CASTS it, so a string is a red-screen crash
  // (`java.lang.String cannot be cast to java.lang.Double` out of `RCTText`) rather than a fallback.
  // The web branch keeps the em strings; this asserts the native branch converted them.
  const fonts = tamaguiConfig.fonts as Record<string, { letterSpacing: Record<string, { val?: unknown }> }>
  for (const [face, font] of Object.entries(fonts)) {
    for (const [name, token] of Object.entries(font.letterSpacing ?? {})) {
      const value = token?.val ?? token
      if (typeof value !== 'number')
        throw new Error(`fonts.${face}.letterSpacing.${name} is ${JSON.stringify(value)} — RN needs a number of points`)
    }
  }
  // `-0.025em` against the 16px base.
  const tight = fonts.body.letterSpacing['tight']
  expect((tight?.val ?? tight) as number).toBe(-0.4)
})

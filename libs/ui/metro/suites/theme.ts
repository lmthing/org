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

test('the Tailwind-parity space scale survives onto native ($4 === 16px)', () => {
  // Tamagui strips the `$` when it keys the token table; the VARIABLE it holds keeps `$4` as its
  // key and carries the resolved number.
  const space = tamaguiConfig.tokens.space as Record<string, { key: string; val: unknown }>
  expect(space['4'].key).toBe('$4')
  expect(space['4'].val).toBe(16)
})

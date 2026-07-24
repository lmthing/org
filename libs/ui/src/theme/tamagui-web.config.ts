/**
 * tamagui-web.config.ts — the WEB-only Tamagui config (Part III / B2).
 *
 * On web, the surfaces get ALL their colors from `theme.css` + Tailwind classes (the app's theming
 * is CSS-var + `data-theme` driven, including arbitrary space themes and runtime `--lm-*` overrides).
 * The Tamagui web primitives (`Row`/`Col`/`Box`/…) are **layout-only** — they use no theme color
 * tokens — so the web config deliberately defines a SINGLE EMPTY theme (`app`) with no color vars.
 *
 * Why a separate config (not the shared `tamagui.config.ts`): a `TamaguiProvider` renders its theme
 * and Tamagui injects that theme's vars as `--background`/… scoped to a `.t_<name>` class on the
 * provider wrapper. With the colored `light`/`dark` themes present, an empty `app` theme INHERITS
 * `light`, so `--background` resolves to the light value inside the provider and **overrides
 * `theme.css` in dark mode** (verified: `apps/web/b0-probe/theme-check`). A config whose ONLY theme
 * is empty injects nothing that collides — `theme.css` keeps full control in every theme (verified:
 * `bg-background` resolves correctly in both light and dark). The colored `tamagui.config.ts` stays
 * the NATIVE render target (via the `*.native.tsx` forks) and the token-parity test's subject.
 *
 * Import `styled`/`View`/`Text` FROM HERE in the web primitives so this config's `createTamagui`
 * side-effect isn't tree-shaken (`@lmthing/ui` is `sideEffects:false`).
 */
import { createTamagui } from '@tamagui/core'
import { radius, fonts } from '@lmthing/css/tamagui-tokens'

const radiusTokens = { ...radius, true: radius['radius-md'] } as Record<string, string | number>

const spaceScale = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, true: 16 } as const
const fontSize = { 1: 11, 2: 12, 3: 13, 4: 14, 5: 16, 6: 18, 7: 20, 8: 24, 9: 30, 10: 36, true: 14 } as const
const lineHeight = { 1: 16, 2: 16, 3: 18, 4: 20, 5: 24, 6: 26, 7: 28, 8: 32, 9: 38, 10: 44, true: 20 } as const
const makeFont = (family: string) => ({ family, size: fontSize, lineHeight })

export const tamaguiWebConfig = createTamagui({
  // ONE empty theme — no color keys → no `--*` injection that collides with theme.css.
  themes: { app: {} as Record<string, string> },
  tokens: {
    color: {},
    radius: radiusTokens,
    space: spaceScale,
    size: spaceScale,
    zIndex: { 0: 0, 1: 100, 2: 200, 3: 300, 4: 400, 5: 500, true: 0 },
  },
  fonts: {
    body: makeFont(fonts['font-sans']),
    heading: makeFont(fonts['font-display']),
    mono: makeFont(fonts['font-mono']),
  },
  settings: { allowedStyleValues: 'somewhat-strict' },
})

export type TamaguiWebConfig = typeof tamaguiWebConfig

export { styled, View, Text } from '@tamagui/core'
export default tamaguiWebConfig

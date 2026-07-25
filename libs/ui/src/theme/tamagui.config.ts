/**
 * tamagui.config.ts — the buildable `createTamagui` shell (Phase 1 of the Tamagui migration).
 *
 * This is the thin runtime counterpart of the PURE-DATA token module
 * `@lmthing/css/tamagui-tokens` (`libs/css/src/tamagui/tokens.generated.ts`, generated from
 * `tokens.json`). That module has NO `@tamagui/core` import so the Layer-1 token-parity vitest
 * can load it in a bare node env; THIS file feeds the same data into `createTamagui` so the
 * primitives (§4) can render on both web and native from one config.
 *
 * Because every color / radius / font value here comes verbatim from the generated module —
 * which the token-parity test proves is byte-identical to `theme.css` — the Tamagui and Tailwind
 * (`theme.css`) render targets cannot drift. See docs/react-native-tamagui-migration.md §5 / §6.
 *
 * Coexistence: the surfaces still carry their Tailwind classNames, which the primitives pass
 * through untouched. Tamagui's output and `theme.css` live side by side during the migration;
 * the Tamagui theme keys below are consumed by the primitives' block-compat resets and by native.
 */
import { createTamagui } from '@tamagui/core'
import {
  radius,
  fonts,
  themes,
  space as spaceTokens,
  size as sizeTokens,
  fontSizes,
  lineHeights,
  fontWeights,
  letterSpacings,
  zIndex as zIndexTokens,
  media as mediaConfig,
} from '@lmthing/css/tamagui-tokens'
import { createAnimations as createNativeAnimations } from '@tamagui/animations-react-native'

// ── Color palette token ────────────────────────────────────────────────────────────────────
// Tamagui's `tokens.color` is a flat palette; our themes reference raw hex directly, but a
// populated palette lets `$spectrum-1`… and `$brand-1`… resolve as tokens too. Keyed by the
// same design-token names as the CSS custom properties (light value is the canonical token).
const color = { ...themes.light } as Record<string, string>

// ── Radius token ───────────────────────────────────────────────────────────────────────────
// Values are the exact CSS strings ("0.375rem", "9999px", …) from tokens.json. Kept as strings
// so web output equals `--radius-*`; a numeric alias `true` gives styled() a sane default.
const radiusTokens = { ...radius, true: radius['radius-md'] } as Record<string, string | number>

// ── Space / size scale (SPIKE B — Tailwind parity) ───────────────────────────────────────────
// The Tailwind spacing scale, generated from `libs/css/scripts/tamagui-tokens.mjs` and proven
// 1:1 with Tailwind by `scale-parity.test.ts`. `$4` === `p-4` === 16px, so the P3 class→prop
// codemod is mechanical. Cast to a plain map for createTamagui's token typing.
const spaceScale = { ...spaceTokens } as Record<string, number>
const sizeScale = { ...sizeTokens } as Record<string, number>
const zIndexScale = { ...zIndexTokens } as Record<string, number>

// ── Fonts (SPIKE B — Tailwind type ramp + weight + tracking) ──────────────────────────────────
// Family strings are the exact `--font-*` values. size/lineHeight are Tailwind's `text-*` ramp
// (`$sm` === `text-sm`); `weight` is Tailwind's `font-*` weights; `letterSpacing` is `tracking-*`.
// All keyed by Tailwind's names so the codemod maps class→prop without a lookup table.
const makeFont = (family: string) => ({
  family,
  size: { ...fontSizes } as Record<string, number>,
  lineHeight: { ...lineHeights } as Record<string, number>,
  weight: { ...fontWeights } as Record<string, string>,
  letterSpacing: { ...letterSpacings } as Record<string, string>,
})

/**
 * The NATIVE config gets the same animation NAMES as the web config so a surface's `animation="quick"`
 * means the same thing on both platforms. The driver differs by necessity — this one is
 * `animations-react-native`, since there is no CSS on native — but the names and durations line up.
 * See docs/tamagui-idiomatic-migration.md §5.
 */
const nativeAnimations = createNativeAnimations({
  none: { type: 'timing', duration: 0 },
  quick: { type: 'timing', duration: 150 },
  medium: { type: 'timing', duration: 200 },
  slow: { type: 'timing', duration: 300 },
})

export const tamaguiConfig = createTamagui({
  animations: nativeAnimations,
  // `themes.light`/`themes.dark` map design-token names → resolved hex, verbatim from the
  // generated module. `background`, `foreground`, `border`, … are directly usable as `$token`.
  // These are the NATIVE render target (resolved hex). The WEB config uses the `var(--name)`
  // indirection (SPIKE A1, see tamagui-web.config.ts) so runtime space themes keep working.
  themes: {
    light: themes.light as Record<string, string>,
    dark: themes.dark as Record<string, string>,
  },
  tokens: {
    color,
    radius: radiusTokens,
    space: spaceScale,
    size: sizeScale,
    zIndex: zIndexScale,
  },
  fonts: {
    body: makeFont(fonts['font-sans']),
    heading: makeFont(fonts['font-display']),
    mono: makeFont(fonts['font-mono']),
  },
  // Tailwind breakpoints (SPIKE B) so `md:`→`$md`/`$gtSm` media props resolve identically.
  media: mediaConfig as Record<string, { minWidth: number }>,
  settings: {
    // Web coexistence: allow className passthrough on all primitives so the surfaces' existing
    // Tailwind/theme.css classes keep applying alongside Tamagui's output.
    allowedStyleValues: 'somewhat-strict',
  },
})

export type TamaguiConfig = typeof tamaguiConfig

// Re-export the styled runtime FROM this module so a primitive that does
// `import { styled, View } from '…/theme/tamagui.config'` transitively retains this module —
// and thus the `createTamagui()` call above that registers the config. A bare side-effect
// `import '…/tamagui.config'` would be tree-shaken away because @lmthing/ui declares
// `"sideEffects": false`, leaving Tamagui unconfigured (getConfig → "Err0") at render time.
// Every Tamagui primitive MUST import its styled/View/Text from here, never from '@tamagui/core'.
export { styled, View, Text } from '@tamagui/core'
export type { GetProps } from '@tamagui/core'

// Ambient module augmentation so `styled()` calls get typed `$token` autocompletion.
declare module '@tamagui/core' {
  interface TamaguiCustomConfig extends TamaguiConfig {}
}

export default tamaguiConfig

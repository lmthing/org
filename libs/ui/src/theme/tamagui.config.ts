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
import { radius, fonts, themes } from '@lmthing/css/tamagui-tokens'

// ── Color palette token ────────────────────────────────────────────────────────────────────
// Tamagui's `tokens.color` is a flat palette; our themes reference raw hex directly, but a
// populated palette lets `$spectrum-1`… and `$brand-1`… resolve as tokens too. Keyed by the
// same design-token names as the CSS custom properties (light value is the canonical token).
const color = { ...themes.light } as Record<string, string>

// ── Radius token ───────────────────────────────────────────────────────────────────────────
// Values are the exact CSS strings ("0.375rem", "9999px", …) from tokens.json. Kept as strings
// so web output equals `--radius-*`; a numeric alias `true` gives styled() a sane default.
const radiusTokens = { ...radius, true: radius['radius-md'] } as Record<string, string | number>

// ── Space / size scale ─────────────────────────────────────────────────────────────────────
// tokens.json defines NO spacing scale (only color/radius/font), so this is a conventional
// 4px-based scale local to Tamagui — it is NOT part of the token-parity contract. The surfaces
// keep expressing spacing via Tailwind classes; these exist only so `createTamagui` has a valid
// space/size token group and native has a scale to draw on.
const spaceScale = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  true: 16,
} as const

// ── Fonts ──────────────────────────────────────────────────────────────────────────────────
// Family strings are the exact `--font-*` values. Tamagui requires a size/lineHeight scale per
// font face; these mirror a conventional type ramp (not part of the token contract — tokens.json
// carries no font-size scale). `body` is sans, `heading` is the display face, `mono` monospace.
const fontSize = {
  1: 11,
  2: 12,
  3: 13,
  4: 14,
  5: 16,
  6: 18,
  7: 20,
  8: 24,
  9: 30,
  10: 36,
  true: 14,
} as const
const lineHeight = {
  1: 16,
  2: 16,
  3: 18,
  4: 20,
  5: 24,
  6: 26,
  7: 28,
  8: 32,
  9: 38,
  10: 44,
  true: 20,
} as const
const weight = { 4: '400', 6: '600', 7: '700', true: '400' } as const

const makeFont = (family: string) => ({ family, size: fontSize, lineHeight, weight })

export const tamaguiConfig = createTamagui({
  // `themes.light`/`themes.dark` map design-token names → resolved hex, verbatim from the
  // generated module. `background`, `foreground`, `border`, … are directly usable as `$token`.
  themes: {
    light: themes.light as Record<string, string>,
    dark: themes.dark as Record<string, string>,
  },
  tokens: {
    color,
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
  settings: {
    // Web coexistence: allow className passthrough on all primitives so the surfaces' existing
    // Tailwind/theme.css classes keep applying alongside Tamagui's output.
    allowedStyleValues: 'somewhat-strict',
  },
})

export type TamaguiConfig = typeof tamaguiConfig

// Ambient module augmentation so `styled()` calls get typed `$token` autocompletion.
declare module '@tamagui/core' {
  interface TamaguiCustomConfig extends TamaguiConfig {}
}

export default tamaguiConfig

/**
 * tamagui-web.config.ts — the WEB Tamagui config.
 *
 * ## Theming model (SPIKE A / A1 — the #1 risk of the idiomatic migration)
 *
 * The app themes at RUNTIME: `data-theme` on <html> flips light↔dark, and a space can inject
 * arbitrary `--<name>` overrides (`libs/ui/src/theme/theme.ts` `applyThemeTokens`). Tamagui
 * themes are STATIC (baked at `createTamagui`), so they cannot represent an arbitrary
 * user-supplied runtime theme. SPIKE A1 resolves this WITHOUT giving up idiomatic props:
 *
 *   - Colors are exposed as `tokens.color` whose values are `var(--<name>)` (the generated
 *     `webColorTokens`). theme.css's `@theme inline` block already declares
 *     `--color-<name>: var(--<name>)`, so Tamagui injecting the SAME `--color-<name>` decl is
 *     byte-identical — no cycle, no collision. `backgroundColor="$background"` therefore emits
 *     atomic CSS referencing `var(--color-background)` → `var(--background)` → whatever
 *     theme.css (or a runtime space override) currently resolves it to. Idiomatic props AND
 *     runtime space themes, both preserved. Empirically verified in
 *     `apps/web/b0-probe/spike-a-runtime-theme.spec.ts`.
 *   - The theme stays a SINGLE EMPTY `app` theme, exactly as before: a colored `light`/`dark`
 *     theme would inject `.t_light`-scoped vars that override theme.css in dark mode (see
 *     `.issues` history + `theme-check` probe). Colors come from the var-backed TOKENS, not
 *     from an injected Tamagui theme, so nothing collides.
 *
 * The colored, resolved-hex `tamagui.config.ts` stays the NATIVE render target (via the
 * `*.native.tsx` forks) and the token-parity test's subject. Import `styled`/`View`/`Text`
 * FROM HERE in the web primitives so this config's `createTamagui` side-effect isn't
 * tree-shaken (`@lmthing/ui` is `sideEffects:false`).
 */
import { createTamagui } from '@tamagui/core'
import { createAnimations } from '@tamagui/animations-css'
import {
  radius,
  fonts,
  webColorTokens,
  space as spaceTokens,
  size as sizeTokens,
  fontSizes,
  lineHeights,
  fontWeights,
  letterSpacings,
  zIndex as zIndexTokens,
  media as mediaConfig,
} from '@lmthing/css/tamagui-tokens'

/**
 * The animation driver (§5 / P4). The CSS driver is the right one here: every animation this app
 * has is a CSS transition, the app ships `disableExtraction: true` so there is nothing to compile
 * away, and a JS driver would move style off the atomic-class path the whole migration is built on.
 *
 * The names mirror the durations the surfaces actually used as Tailwind classes, so the swap is a
 * rename rather than a redesign: `transition-*` (Tailwind's 150ms default) → `quick`,
 * and the easing is Tailwind's own curve, so the swap is not visible.
 * `duration-200` → `medium`, `duration-300`/`transition-all duration-300` → `slow`. `none` exists
 * so a component can opt out without dropping the prop.
 */
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)' // Tailwind's `ease-in-out`, the curve the surfaces had
const animations = createAnimations({
  none: `${EASE} 0ms`,
  quick: `${EASE} 150ms`,
  medium: `${EASE} 200ms`,
  slow: `${EASE} 300ms`,
})

const radiusTokens = { ...radius, true: radius['radius-md'] } as Record<string, string | number>

// SPIKE B — the Tailwind-parity scales (same source as the native config): `$4` === `p-4`.
const spaceScale = { ...spaceTokens } as Record<string, number>
const sizeScale = { ...sizeTokens } as Record<string, number>
const zIndexScale = { ...zIndexTokens } as Record<string, number>

const makeFont = (family: string) => ({
  family,
  size: { ...fontSizes } as Record<string, number>,
  lineHeight: { ...lineHeights } as Record<string, number>,
  weight: { ...fontWeights } as Record<string, string>,
  letterSpacing: { ...letterSpacings } as Record<string, string>,
})

export const tamaguiWebConfig = createTamagui({
  animations,
  // ONE empty theme — no theme-scoped `--*` injection that would collide with theme.css.
  themes: { app: {} as Record<string, string> },
  tokens: {
    // SPIKE A1: var(--name)-backed colors → idiomatic `$token` props that resolve through
    // theme.css's runtime cascade. Identical to theme.css's own `@theme inline` decls.
    color: { ...webColorTokens } as Record<string, string>,
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
  media: mediaConfig as Record<string, { minWidth: number }>,
  settings: { allowedStyleValues: 'somewhat-strict' },
})

export type TamaguiWebConfig = typeof tamaguiWebConfig

export { styled, View, Text, createComponent } from '@tamagui/core'
export default tamaguiWebConfig

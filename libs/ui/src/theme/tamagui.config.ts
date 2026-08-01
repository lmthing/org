/**
 * tamagui.config.ts — THE Tamagui config. One config, both platforms (phase 5a of
 * `docs/tamagui-final-steps.md`).
 *
 * This replaces the PAIR that used to exist — `tamagui.config.ts` (native, resolved hex) and
 * `tamagui-web.config.ts` (web, `var(--…)`-backed). Everything the two shared — the SPIKE-B Tailwind-parity scales, the
 * radius/font/zIndex tokens, the media breakpoints, `settings` — was duplicated verbatim in both
 * files, which is the drift risk the convergence exists to remove.
 *
 * ## What genuinely differs by platform, and why
 *
 * Exactly four things, all branching on `isWeb` (a build-time-resolvable constant from
 * `@tamagui/core`, so each bundle keeps only its own branch):
 *
 *  1. **Colour tokens.** Web uses `webColorTokens` — every value is `var(--<name>)`. Native has no
 *     CSS variables, so it uses the resolved hex from `themes.light`.
 *  2. **Themes.** Native gets the real `light`/`dark` pair. Web gets ONE EMPTY `app` theme — see the
 *     warning below; that is not a simplification, it is load-bearing.
 *  3. **Animation driver.** `@tamagui/animations-css` on web (every animation this app has is a CSS
 *     transition, and a JS driver would move style off the atomic-class path the whole migration is
 *     built on); `@tamagui/animations-react-native` on native. The NAMES and durations are identical
 *     on both, so a surface's `transition="quick"` means the same thing either way.
 *  4. **The `letterSpacing` scale.** Tailwind's `tracking-*` ramp is em-relative, which React Native
 *     has no unit for — a string there is a hard crash, not a fallback. Native gets the same ramp
 *     converted to points; see `nativeLetterSpacings`.
 *
 * ## SPIKE A / A1 — the theming model, and the bug that must not come back
 *
 * The app themes at RUNTIME: `data-theme` on `<html>` flips light↔dark, and a space can inject
 * arbitrary `--<name>` overrides (`theme.ts` `applyThemeTokens`). Tamagui themes are STATIC, baked at
 * `createTamagui`, so they cannot represent an arbitrary user-supplied runtime theme. A1 resolves that
 * without giving up idiomatic props:
 *
 *  - Colours are `var(--<name>)`-backed tokens, so `backgroundColor="$background"` emits atomic CSS
 *    referencing `var(--color-background)` → `var(--background)` → whatever `theme.css` or a runtime
 *    space override currently resolves it to. `theme.css` declares the same
 *    `--color-<name>: var(--<name>)` aliases, so Tamagui injecting them is byte-identical — no cycle,
 *    no collision. Verified by `apps/web/b0-probe/spike-a-runtime-theme.spec.ts`.
 *  - **The web theme stays a single EMPTY theme.** A coloured `light`/`dark` pair injects
 *    `.t_light`-scoped custom properties that OVERRIDE `theme.css` in dark mode. That was a real
 *    shipped bug (see `.issues` history + the `theme-check` probe). Colours come from the var-backed
 *    tokens, never from an injected Tamagui theme.
 *
 *    This is why the branch below covers `themes` and not only `tokens.color`: handing web the native
 *    theme pair would resurrect that bug, and it is now one boolean away. `pnpm test:surface` captures
 *    light AND dark, so it is the gate that catches it.
 *
 * ## Import discipline — and why re-exporting is NOT enough
 *
 * `createTamagui()` below is what registers `globalThis.__tamaguiConfig`; without it every primitive
 * throws `Err0` at render time. Keeping that call in the bundle takes BOTH of the following, and the
 * second one is the part that was missing for a long time:
 *
 *  1. Every primitive imports its `styled`/`View`/`Text`/`createComponent` FROM THIS MODULE (they are
 *     re-exported at the bottom), never straight from `@tamagui/core`.
 *  2. This module is listed in `package.json` `sideEffects`.
 *
 * (1) alone does nothing. The re-exports at the bottom are *pure* re-exports of `@tamagui/core`, so a
 * bundler resolves `import { styled } from '…/tamagui.config'` transitively and rewrites it to point
 * at `@tamagui/core` directly — and under a blanket `sideEffects: false` it is then free to drop this
 * module entirely, `createTamagui()` and all. That is exactly what happened: the package declared
 * `sideEffects: false`, and every standalone SPA that renders a primitive without also mounting a
 * `<TamaguiProvider config={tamaguiConfig}>` (com, org, social, casa, store, space) shipped a bundle
 * with the Tamagui runtime but no config, and error-boundaried on first paint. The unified web app and
 * the mobile app were immune only because their roots import `tamaguiConfig` AS A VALUE to hand to a
 * provider, which is a use a bundler cannot elide.
 *
 * So the load-bearing guarantee is the `sideEffects` entry, not the re-export. The gate is
 * `tamaguiConfigGuardPlugin` in `libs/utils/src/vite.mjs`, which every SPA build runs: it inspects
 * the emitted module graph and FAILS the build if a bundle carries Tamagui components without this
 * module. It has to live in the bundler — no unit test can see this, because vitest does not
 * tree-shake and every suite here imports the config anyway.
 *
 * See docs/react-native-tamagui-migration.md §5 / §6 and docs/tamagui-idiomatic-migration.md §5.
 */
import { createTamagui, isWeb } from '@tamagui/core'
import { createAnimations as createCssAnimations } from '@tamagui/animations-css'
import { createAnimations as createNativeAnimations } from '@tamagui/animations-react-native'
import {
  radius,
  fonts,
  themes,
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
 * The animation names mirror the durations the surfaces used as Tailwind classes, so the swap was a
 * rename rather than a redesign: `transition-*` (Tailwind's 150ms default) → `quick`,
 * `duration-200` → `medium`, `duration-300` → `slow`. `none` exists so a component can opt out
 * without dropping the prop. The easing is Tailwind's own curve, so the swap is not visible.
 *
 * NOTE the prop is `transition`, NOT `animation` — Tamagui 2.5 renamed it and silently ignores the
 * old name, on every component including a raw `View` (§6).
 */
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)' // Tailwind's `ease-in-out`, the curve the surfaces had
const animations = isWeb
  ? createCssAnimations({
      none: `${EASE} 0ms`,
      quick: `${EASE} 150ms`,
      medium: `${EASE} 200ms`,
      slow: `${EASE} 300ms`,
    })
  : createNativeAnimations({
      none: { type: 'timing', duration: 0 },
      quick: { type: 'timing', duration: 150 },
      medium: { type: 'timing', duration: 200 },
      slow: { type: 'timing', duration: 300 },
    })

/**
 * The platform split, as PURE functions taking `web` rather than reading `isWeb` inline.
 *
 * This is not ceremony. Merging the two configs cost something real: the native branch is
 * unreachable from a jsdom test, where `isWeb` is always true — so the native theme assertions that
 * two separate files gave for free would simply have stopped running, silently. Parameterising the
 * choice keeps BOTH branches unit-testable from either environment
 * (`tamagui-config.test.ts` exercises each), which is strictly better than what the split had.
 *
 * Web: the `var(--<name>)` indirection (SPIKE A1) so runtime space themes keep working.
 * Native: resolved hex, since there are no CSS variables. Either way a populated palette lets
 * `$spectrum-1`…/`$brand-1`… resolve as tokens.
 */
export function buildColorTokens(web: boolean): Record<string, string> {
  return (web ? { ...webColorTokens } : { ...themes.light }) as Record<string, string>
}

/** ONE empty theme on web — see the SPIKE A1 warning above. The real pair is native-only. */
export function buildThemes(web: boolean): Record<string, Record<string, string>> {
  return (
    web ? { app: {} } : { light: themes.light, dark: themes.dark }
  ) as Record<string, Record<string, string>>
}

/**
 * One CSS length → a native number of density-independent pixels. `rem` is relative to the root
 * font size, which on web is 16px by default and on native does not exist at all.
 *
 * Only the units the radius scale actually uses are handled, and anything else throws rather than
 * silently becoming `NaN` — a wrong radius is invisible on screen, so the loud failure is the point.
 */
export function cssLengthToNative(value: string): number {
  const rem = /^(-?[\d.]+)rem$/.exec(value)
  if (rem) return Number(rem[1]) * 16
  const px = /^(-?[\d.]+)px$/.exec(value)
  if (px) return Number(px[1])
  if (/^-?[\d.]+$/.test(value)) return Number(value)
  throw new Error(`cssLengthToNative: cannot express "${value}" as native pixels`)
}

const color = buildColorTokens(isWeb)
const configThemes = buildThemes(isWeb)

/**
 * The radius scale, platform-split for the same reason the colors are (see `buildColorTokens`).
 *
 * Web keeps the exact CSS strings from `tokens.json` ("0.375rem", "9999px", …) so its output equals
 * `--radius-*`. **Native cannot**: React Native takes border radii as NUMBERS of dp, and a `rem` is
 * a CSS unit it has no way to resolve — so before this split every native corner was styled with a
 * string like `"0.5rem"`. Nothing on web could see it; the Metro render harness could
 * (`libs/ui/metro`), which is how it was found.
 *
 * The numeric `true` alias gives `styled()` a sane default on both.
 */
export function buildRadiusTokens(web: boolean): Record<string, string | number> {
  const scale = web
    ? { ...radius }
    : Object.fromEntries(Object.entries(radius).map(([k, v]) => [k, cssLengthToNative(v)]))
  return { ...scale, true: scale['radius-md'] } as Record<string, string | number>
}

const radiusTokens = buildRadiusTokens(isWeb)

/**
 * SPIKE B — the Tailwind-parity scales, generated by `libs/css/scripts/tamagui-tokens.mjs` and proven
 * 1:1 with Tailwind by `scale-parity.test.ts`. `$4` === `p-4` === 16px, which is what made the
 * class→prop codemod mechanical.
 */
const spaceScale = { ...spaceTokens } as Record<string, number>
const sizeScale = { ...sizeTokens } as Record<string, number>
const zIndexScale = { ...zIndexTokens } as Record<string, number>

/**
 * Family strings are the exact `--font-*` values. `size`/`lineHeight` are Tailwind's `text-*` ramp
 * (`$sm` === `text-sm`), `weight` its `font-*` weights, `letterSpacing` its `tracking-*` — all keyed
 * by Tailwind's names, which is why the codemod needed no lookup table.
 */
/**
 * The font size the em→point conversion below is anchored to — `$base`, i.e. `text-base`, 16px.
 */
const LETTER_SPACING_BASE_PX = 16

/**
 * Tailwind's `tracking-*` ramp, in POINTS, for the native target.
 *
 * The em strings the web branch keeps are valid CSS and invalid React Native: `letterSpacing` is a
 * number of points there, and Android's view manager casts the value to a `Double` — so a string
 * does not degrade, it CRASHES the screen (`java.lang.String cannot be cast to java.lang.Double`,
 * raised by `RCTText` the moment a chat transcript mounted).
 *
 * Points are absolute where em is relative, so this is an approximation by construction: it is
 * exact at 16px and drifts proportionally at other sizes. That is the trade React Native forces —
 * there is no relative unit to convert INTO — and at this ramp's magnitudes (±0.05em, i.e. under a
 * point) the drift is sub-pixel. Web is untouched, so the Tailwind parity tests still describe it.
 */
const nativeLetterSpacings = Object.fromEntries(
  Object.entries(letterSpacings).map(([key, em]) => [key, Number.parseFloat(em) * LETTER_SPACING_BASE_PX]),
) as Record<string, number>

/**
 * Native cannot take a CSS font stack. `family` is `"Manrope, system-ui, sans-serif"` — perfect on
 * web, but React Native reads the whole string as one family name, misses, and silently falls back
 * to Roboto/SF. So on native we hand Tamagui the FIRST family only, unquoted.
 */
const nativeFamily = (stack: string) => (stack.split(',')[0] ?? stack).trim().replace(/^['"]|['"]$/g, '')

/**
 * Android will not synthesise a weight from a single registered face — ask for 700 on a family that
 * registered only its Regular and you get Regular, not bold. Tamagui's `face` map is the supported
 * fix: it maps a numeric weight onto a separately-registered family name. These names must match the
 * keys in `apps/mobile/src/fonts.ts#FONT_ASSETS` exactly.
 */
export const NATIVE_FACE: Record<string, Record<string, { normal: string }>> = {
  Manrope: {
    400: { normal: 'Manrope' },
    500: { normal: 'Manrope-Medium' },
    600: { normal: 'Manrope-SemiBold' },
    700: { normal: 'Manrope-Bold' },
    800: { normal: 'Manrope-ExtraBold' },
  },
  'JetBrains Mono': {
    400: { normal: 'JetBrains Mono' },
    500: { normal: 'JetBrains Mono-Medium' },
  },
  // The wordmark ships as a single Bold cut, so every weight resolves to the one face.
  'TypeMates Cera Round Pro Bold': {
    400: { normal: 'TypeMates Cera Round Pro Bold' },
    600: { normal: 'TypeMates Cera Round Pro Bold' },
    700: { normal: 'TypeMates Cera Round Pro Bold' },
  },
}

const makeFont = (family: string) => ({
  family: isWeb ? family : nativeFamily(family),
  ...(isWeb ? {} : { face: NATIVE_FACE[nativeFamily(family)] }),
  size: { ...fontSizes } as Record<string, number>,
  lineHeight: { ...lineHeights } as Record<string, number>,
  weight: { ...fontWeights } as Record<string, string>,
  // Tamagui types `GenericFont['letterSpacing']` as `number | Variable`, but Tailwind's `tracking-*`
  // ramp is em-RELATIVE (`-0.05em`) and must stay a string ON WEB — resolving it to px would break
  // it at every font size. The runtime carries the string through unharmed; `tamagui-config.test.ts`
  // asserts every entry round-trips and that `$tight` still ends in `em`, which is what makes this
  // cast safe rather than a silent lie. Native cannot take the string at all — see
  // `nativeLetterSpacings`.
  letterSpacing: (isWeb
    ? ({ ...letterSpacings } as unknown as Record<string, number>)
    : nativeLetterSpacings),
})

export const tamaguiConfig = createTamagui({
  animations,
  themes: configThemes,
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
    // The wordmark's own face, deliberately NOT the UI face. `font-sans`/`font-display` moved off
    // Cera Round Pro Bold (a rounded DISPLAY cut, shipped in one weight, which made every label on
    // every surface read as heavy and playful); the logo keeps it, because that letterform IS the
    // brand mark. Only `elements/branding/cozy-text` should reference `$brand`.
    brand: makeFont(fonts['font-brand']),
  },
  // Tailwind breakpoints (SPIKE B) so `md:` → `$md`/`$gtSm` media props resolve identically.
  media: mediaConfig as Record<string, { minWidth: number }>,
  settings: {
    // Allows className passthrough on the primitives, which the host-passthrough leaves rely on.
    allowedStyleValues: 'somewhat-strict',
  },
})

export type TamaguiConfig = typeof tamaguiConfig

/**
 * `tamaguiWebConfig` is the historical name for what is now the single config. Kept as an alias so the
 * `<TamaguiProvider config={…}>` call sites and test harnesses did not all have to churn inside the
 * same change that merged the two configs.
 */
export const tamaguiWebConfig = tamaguiConfig
export type TamaguiWebConfig = TamaguiConfig

// See "Import discipline" above — these re-exports are what keep `createTamagui()` from being
// tree-shaken out of the bundle.
export { styled, View, Text, createComponent } from '@tamagui/core'
export type { GetProps } from '@tamagui/core'

// Ambient module augmentation so `styled()` calls get typed `$token` autocompletion.
declare module '@tamagui/core' {
  // An interface with no members of its own IS the point here, and `type X = Y` cannot replace it:
  // module augmentation merges DECLARATIONS, so Tamagui only picks this config up if the shape
  // arrives as an `interface` extending it. The rule is correct in general and wrong here.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends TamaguiConfig {}
}

export default tamaguiConfig

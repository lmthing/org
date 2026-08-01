import { describe, it, expect } from 'vitest'
import { themes } from '@lmthing/css/tamagui-tokens'

/**
 * **The dark theme has to be legible, and that has to be measured rather than argued.**
 *
 * The mobile app spent a release hard-locked to light — `App.tsx` pinned the Tamagui theme and
 * `app.config.js` pinned `userInterfaceStyle` — on the grounds that "the shared dark theme's
 * contrast breaks down on-device". That was true of the palette at the time and there was no way to
 * tell when it stopped being true, so the lock outlived the problem: the Slate Teal palette replaced
 * every one of those colours and the app still shipped light-only.
 *
 * This is the thing that was missing. Every semantic foreground/ground pair is measured against
 * WCAG 2.1 in BOTH themes, so "is dark readable?" is a test result. A palette edit that regresses
 * one fails here, at write time, instead of on a phone.
 *
 * NOT covered, deliberately: `border`/`input` against their grounds. A separator is meant to be a
 * low-contrast hairline — both themes sit near 1.3:1 by design, and holding them to a text ratio
 * would mean drawing boxes in near-white. WCAG's 3:1 non-text rule is about controls whose
 * BOUNDARY carries the meaning; these are decorative rules inside already-distinct surfaces.
 */

type Rgb = [number, number, number]

const parseHex = (value: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (!m) throw new Error(`not a 6-digit hex colour: "${value}"`)
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** WCAG 2.1 relative luminance. */
const luminance = (rgb: Rgb): number => {
  const [r, g, b] = rgb.map((channel) => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio, 1:1 … 21:1. */
export const contrastRatio = (fg: string, bg: string): number => {
  const [hi, lo] = [luminance(parseHex(fg)), luminance(parseHex(bg))].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Foreground token → the ground it is actually painted on. Every pair here is one a component
 * really renders; a pair nothing draws would be a ratio nobody can regress.
 */
const TEXT_PAIRS: ReadonlyArray<readonly [fg: string, bg: string]> = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'card'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
]

/** The focus ring is a non-text indicator, so WCAG's 3:1 applies rather than 4.5:1. */
const NON_TEXT_PAIRS: ReadonlyArray<readonly [fg: string, bg: string]> = [
  ['ring', 'background'],
  ['ring', 'card'],
]

const AA_TEXT = 4.5
const AA_NON_TEXT = 3

describe.each(['light', 'dark'] as const)('%s theme contrast', (name) => {
  const theme = themes[name] as Record<string, string>

  it.each(TEXT_PAIRS)('%s on %s clears WCAG AA for body text', (fg, bg) => {
    expect(theme[fg], `${name}.${fg} is missing`).toBeTypeOf('string')
    expect(theme[bg], `${name}.${bg} is missing`).toBeTypeOf('string')
    const ratio = contrastRatio(theme[fg], theme[bg])
    expect(
      ratio,
      `${name}: ${fg} (${theme[fg]}) on ${bg} (${theme[bg]}) is ${ratio.toFixed(2)}:1, below ${AA_TEXT}:1`,
    ).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(NON_TEXT_PAIRS)('%s on %s clears WCAG AA for a non-text indicator', (fg, bg) => {
    const ratio = contrastRatio(theme[fg], theme[bg])
    expect(
      ratio,
      `${name}: ${fg} (${theme[fg]}) on ${bg} (${theme[bg]}) is ${ratio.toFixed(2)}:1, below ${AA_NON_TEXT}:1`,
    ).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })
})

/**
 * The two themes must describe the SAME palette. A key that exists in one and not the other is the
 * failure mode that is invisible on whichever theme you happen to be developing in — the component
 * reading it falls through to Tamagui's token map, which on native is built from `themes.light`
 * (`tamagui.config.ts#buildColorTokens`). So a dark-only gap does not render "wrong-ish": it renders
 * the LIGHT colour, at full strength, in the middle of a dark screen.
 */
it('light and dark declare exactly the same token names', () => {
  expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort())
})

/**
 * Native has no CSS variables and no `color-mix()`; React Native parses `#rrggbb` and `rgba()` and
 * nothing else. A value that is neither reaches the view manager as an unparseable string, where
 * Android's colour parser throws — which is a red screen, not a wrong shade.
 */
it('every theme value is a colour React Native can parse', () => {
  const ok = /^(#[0-9a-f]{6}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\))$/i
  for (const name of ['light', 'dark'] as const) {
    for (const [key, value] of Object.entries(themes[name])) {
      expect(ok.test(String(value)), `${name}.${key} = "${value}" is not native-parseable`).toBe(true)
    }
  }
})

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { NATIVE_FACE } from '@lmthing/ui/theme/tamagui.config'

/**
 * **`FONT_ASSETS` and `NATIVE_FACE` are one contract split across two files, and nothing enforced it.**
 *
 * `libs/ui/.../tamagui.config.ts#NATIVE_FACE` maps a numeric `fontWeight` onto a family NAME —
 * Android will not synthesise a weight, so `fontWeight: 600` on Manrope has to become the separately
 * registered family `"Manrope-SemiBold"`. `apps/mobile/src/fonts.ts#FONT_ASSETS` is what registers
 * those names with `expo-font`. If the two disagree by one character, React Native looks up a family
 * that was never registered, finds nothing, and **falls back to Roboto/SF without an error** — the
 * app boots, `useFonts` resolves with no `error`, and only a screenshot shows it.
 *
 * That is exactly the failure that had a `console.log` font probe left behind in `App.tsx` to chase.
 * This is the gate that makes the probe unnecessary.
 *
 * `FONT_ASSETS` cannot be IMPORTED here: its values are `require()`s of `.ttf`/`.otf` files, which
 * only Metro's asset transformer can resolve — Vitest would throw on the first one. So the keys are
 * read out of the source text instead, which is also what keeps this test honest about the file
 * Metro actually bundles rather than a re-declaration of it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const fontsSource = readFileSync(resolve(here, 'fonts.ts'), 'utf8')

/** Every `key: require('…')` entry in `FONT_ASSETS`, as [registered family name, asset path]. */
const entries = [...fontsSource.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*require\('([^']+)'\)/gm)].map(
  (m) => ({ family: m[1] ?? m[2] ?? m[3], asset: m[4] }),
)

/** Every family name any weight in any font resolves to, flattened. */
const facesNeeded = [
  ...new Set(
    Object.values(NATIVE_FACE).flatMap((weights) => Object.values(weights).map((f) => f.normal)),
  ),
].sort()

describe('the mobile font registry', () => {
  it('parsed the asset table (guards the regex itself against a refactor)', () => {
    expect(entries.length).toBeGreaterThanOrEqual(facesNeeded.length)
  })

  it('registers every family NATIVE_FACE resolves a weight to', () => {
    const registered = new Set(entries.map((e) => e.family))
    const missing = facesNeeded.filter((f) => !registered.has(f))
    expect(
      missing,
      `NATIVE_FACE maps a weight onto ${missing.join(', ')}, which expo-font never registers — ` +
        'React Native will silently render the platform default instead.',
    ).toEqual([])
  })

  it('registers nothing NATIVE_FACE never asks for', () => {
    // Not cosmetic: an unreferenced face is a font shipped in the binary that no `fontWeight` can
    // ever select, which means the weight someone intended it for is silently resolving elsewhere.
    const needed = new Set(facesNeeded)
    const orphans = entries.map((e) => e.family).filter((f) => !needed.has(f))
    expect(orphans, `registered but unreachable from any NATIVE_FACE weight: ${orphans.join(', ')}`).toEqual([])
  })

  it('points every entry at a font file that exists', () => {
    for (const { family, asset } of entries) {
      const path = resolve(here, asset)
      expect(existsSync(path), `${family} → ${asset} does not exist (Metro fails the bundle)`).toBe(true)
    }
  })

  it('sources every face from the design system, not a copy in this app', () => {
    // A copy here would let the wordmark drift between web and native — the same drift that put a
    // stale Cera .otf at two different public/ roots.
    for (const { family, asset } of entries) {
      expect(asset, `${family} must come from libs/css/assets/fonts`).toContain('libs/css/assets/fonts/')
    }
  })
})

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `lineHeight` is a NUMBER OF PIXELS on this surface, never a CSS ratio.
 *
 * Tamagui appends `px` to whatever number a style prop is given, so the Tailwind `leading-relaxed`
 * idiom carried over from the pre-Tamagui CSS — `lineHeight={1.625}` — compiled to
 * `line-height: 1.625px`. Every wrapped line of a chat message was then painted on top of the line
 * before it: the transcript read as one smear of overlapping glyphs, on web AND in the store
 * screenshots taken from it. `lineHeight={1}` ("no extra leading") has the same defect, a 1px line
 * box, and is merely less visible because those call sites are single-line.
 *
 * The native fork already refuses a ratio (`isNativeLineHeight` in `elements/primitives/_native.tsx`
 * drops anything under 4pt). This is the web half of that same rule, enforced where it is cheap: at
 * the source, so the fix happens while the line is being written rather than in a screenshot weeks
 * later. Nothing renders a line box under 4px on purpose, which is what makes the threshold a units
 * test rather than a magic number.
 */
const SRC = new URL('../../', import.meta.url).pathname // libs/ui/src

function* tsxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules') continue
      yield* tsxFiles(path)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield path
    }
  }
}

describe('lineHeight units', () => {
  it('is never a bare ratio — Tamagui would render it as that many PIXELS', () => {
    // `lineHeight={1.625}` / `lineHeight: 1` and friends; a `$token` or a px string is fine.
    const ratio = /lineHeight(?:=\{|:\s*)(\d(?:\.\d+)?)\b/g
    const offenders: string[] = []
    for (const file of tsxFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(ratio)) {
        if (Number(m[1]) < 4) offenders.push(`${file.slice(SRC.length)}: ${m[0]}`)
      }
    }
    expect(offenders, 'use px (e.g. lineHeight={24}), not a CSS ratio').toEqual([])
  })
})

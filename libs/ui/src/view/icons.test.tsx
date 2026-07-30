import * as React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '../test-utils/index'
import { ViewIcon, StarGlyph } from './icons'
import { ICON_NAMES, type Tone } from './types'

/**
 * **No `$token` may reach an SVG paint attribute.**
 *
 * `Prim.Svg` is a styled Tamagui component on web, so `stroke="$foreground"` resolves to a CSS var
 * and looks fine — which is exactly why this went unnoticed. On native the primitive is a bare
 * re-export of `react-native-svg`, which has no token layer: it parses the string as a colour,
 * fails, and draws NOTHING. Measured on the emulator against the first model-built app: 25×
 * `"$foreground" is not a valid color or brush`, and every toned icon silently missing — the row
 * actions' `check` glyphs existed as `PathView` nodes and painted nothing.
 *
 * jsdom cannot see native, so this asserts the thing that IS portable: whatever ends up on the
 * paint attributes must be a real colour value, never an unresolved token. That is the property the
 * native renderer needs, and it is checkable here.
 */

const TONES: Exclude<Tone, 'auto'>[] = ['neutral', 'accent', 'success', 'warning', 'info', 'danger']

/** Every paint attribute on every SVG the tree produced. */
function paints(container: HTMLElement): string[] {
  const out: string[] = []
  container.querySelectorAll('svg, path, circle, rect, line, polyline, polygon, ellipse').forEach((el) => {
    for (const attr of ['stroke', 'fill', 'color']) {
      const v = el.getAttribute(attr)
      if (v) out.push(v)
    }
  })
  return out
}

describe('icon colours resolve to real values, never to a token', () => {
  it('resolves every tone — a $token here is invisible on native', () => {
    for (const tone of TONES) {
      const { container, unmount } = render(<ViewIcon name="check" tone={tone} />)
      const bad = paints(container).filter((v) => v.startsWith('$'))
      expect(bad, `tone="${tone}" left an unresolved token on an SVG paint attribute`).toEqual([])
      unmount()
    }
  })

  it('resolves an explicit token colour too — the shell passes $primary to its nav icons', () => {
    const { container } = render(<ViewIcon name="home" color="$primary" />)
    expect(paints(container).filter((v) => v.startsWith('$'))).toEqual([])
  })

  it('leaves a real colour and `currentColor` alone', () => {
    const { container: hex } = render(<ViewIcon name="check" color="#ff0000" />)
    expect(paints(hex)).toContain('#ff0000')
    // No tone and no colour is the inherit case, which is valid on both targets as-is.
    const { container: plain } = render(<ViewIcon name="check" />)
    expect(paints(plain).filter((v) => v.startsWith('$'))).toEqual([])
  })

  it('resolves the star, whose default is $warning — every `rating` star was blank on a phone', () => {
    for (const filled of [true, false]) {
      const { container, unmount } = render(<StarGlyph filled={filled} />)
      expect(paints(container).filter((v) => v.startsWith('$')), `filled=${filled}`).toEqual([])
      unmount()
    }
  })

  it('holds for EVERY glyph in the closed set, so a new one cannot reintroduce it', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<ViewIcon name={name} tone="danger" />)
      expect(paints(container).filter((v) => v.startsWith('$')), `icon "${name}"`).toEqual([])
      unmount()
    }
  })
})

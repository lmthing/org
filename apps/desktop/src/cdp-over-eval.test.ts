import { describe, it, expect } from 'vitest'
import { cdpViaEval } from './cdp-over-eval'
import type { PageDriver } from './page-tools'

/**
 * The CDP surface, answered by a webview.
 *
 * Two things are being asserted, and the second matters more. First, that the methods agents
 * actually send still work — the point of keeping the interface rather than deleting it. Second,
 * that the ones which CANNOT work are refused BY NAME. A translation layer that quietly does
 * something adjacent is far more damaging than one that admits a gap: a model handed a synthesised
 * `backendNodeId` builds a plan on ids that mean nothing, and every later failure is then blamed on
 * the wrong thing.
 */

function page(answers: Array<[RegExp, string]> = []): PageDriver & { evaluated: string[] } {
  const evaluated: string[] = []
  return {
    evaluated,
    evaluate(expression: string) {
      evaluated.push(expression)
      for (const [pattern, value] of answers) {
        if (pattern.test(expression)) return Promise.resolve(value)
      }
      return Promise.resolve('')
    },
    navigate: () => Promise.resolve(),
    currentUrl: () => Promise.resolve('https://example.test/'),
  }
}

describe('methods that translate', () => {
  it('answers Runtime.evaluate in the protocol’s own shape', async () => {
    // A caller written against CDP must need no special case here, or "keep the interface" was not
    // actually kept.
    const p = page([[/2 \+ 2/, '4']])
    const r = await cdpViaEval(p, 'Runtime.evaluate', { expression: '2 + 2' })
    expect(r.ok).toBe(true)
    expect(r.result).toEqual({ result: { value: 4 } })
  })

  it('clicks whatever is at the point, for a mouse press', async () => {
    const p = page([[/elementFromPoint/, 'clicked']])
    const r = await cdpViaEval(p, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 12, y: 34 })
    expect(r.ok).toBe(true)
    expect(p.evaluated.some((e) => e.includes('elementFromPoint(12,34)'))).toBe(true)
  })

  it('ignores the move and release, so one click is one click', async () => {
    // CDP callers send moved/pressed/released as three calls. Acting on each would click three
    // times — which on a "Buy" button is not a cosmetic bug.
    const p = page()
    await cdpViaEval(p, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 2 })
    await cdpViaEval(p, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 2 })
    expect(p.evaluated.filter((e) => e.includes('elementFromPoint'))).toHaveLength(0)
  })

  it('reports a press that hit nothing rather than claiming success', async () => {
    const p = page([[/elementFromPoint/, 'no element at point']])
    const r = await cdpViaEval(p, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 9, y: 9 })
    expect(r.ok).toBe(false)
  })

  it('accepts the emulation setup calls that describe things already true', async () => {
    // These arrive as setup before something that DOES work. Failing them would break the call
    // that follows, for no gain.
    for (const m of ['Emulation.setDeviceMetricsOverride', 'Emulation.setFocusEmulationEnabled']) {
      expect((await cdpViaEval(page(), m, {})).ok).toBe(true)
    }
  })

  it('says out loud that its cookie list is partial', async () => {
    const p = page([[/document\.cookie/, 'a=1; b=2']])
    const r = await cdpViaEval(p, 'Network.getCookies', {})
    const result = r.result as { cookies: Array<{ name: string }>; note: string }
    expect(result.cookies.map((c) => c.name)).toEqual(['a', 'b'])
    expect(result.note).toMatch(/HttpOnly/)
  })

  it('admits that history entries are not readable', async () => {
    // `history.length` is all a page may know. Returning invented URLs for the other entries would
    // be the exact failure this file is written to avoid.
    const p = page([[/history\.length/, '3'], [/location\.href/, 'https://c.test/']])
    const r = await cdpViaEval(p, 'Page.getNavigationHistory', {})
    const result = r.result as { entries: Array<{ url: string | null }>; note: string }
    expect(result.entries).toHaveLength(3)
    expect(result.entries[0]?.url).toBeNull()
    expect(result.note).toMatch(/cannot read/)
  })
})

describe('methods that cannot translate are refused by name', () => {
  it.each([
    ['DOM.getDocument', /backendNodeId/],
    ['DOM.querySelector', /Runtime.evaluate/],
    ['Accessibility.getFullAXTree', /accessibility tree/i],
    ['Debugger.enable', /debugger/i],
    ['Fetch.enable', /interception/i],
  ])('refuses %s with a reason', async (method, why) => {
    const r = await cdpViaEval(page(), method, {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(why)
    // The method itself must appear, or a model cannot tell WHICH of its calls was refused.
    expect(r.error).toContain(method.split('.')[0])
  })

  it('refuses an unknown method and names what does work', async () => {
    const r = await cdpViaEval(page(), 'Storage.clearDataForOrigin', {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Runtime.evaluate/)
  })

  it('covers a whole domain by prefix, not method by method', async () => {
    // A `DOM.*` method added to the protocol tomorrow is just as untranslatable. A list of
    // individual names would let it fall through to "unknown method", which explains nothing.
    const r = await cdpViaEval(page(), 'DOM.aMethodThatDoesNotExistYet', {})
    expect(r.error).toMatch(/backendNodeId/)
  })
})

import { describe, it, expect } from 'vitest'
import { callTool } from './browser-tools'
import type { CdpClient } from './cdp'

/**
 * What the agent's tools actually send to the browser.
 *
 * The translation is where a tool quietly becomes a different tool. `clickAt` calling
 * `element.click()` instead of dispatching real input still "works" on a simple page and fails on
 * every login flow, every menu and every combobox — with no error, because a synthetic click IS a
 * click as far as the DOM is concerned. So the assertions below are about the WIRE: which protocol
 * commands went out, in what order.
 */

class FakeCdp {
  calls: Array<{ method: string; params: Record<string, unknown> }> = []
  /** Where in its history the page is. Overridden to test the ends of the list. */
  history = { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] }
  /** Answers for `Runtime.evaluate`, chosen by what the expression contains. */
  constructor(private answers: Array<[RegExp, unknown]> = []) {}

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params })
    if (method === 'Runtime.evaluate') {
      const expr = String(params['expression'] ?? '')
      for (const [pattern, value] of this.answers) {
        if (pattern.test(expr)) return Promise.resolve({ result: { value } })
      }
      return Promise.resolve({ result: { value: '' } })
    }
    if (method === 'Page.getNavigationHistory') {
      return Promise.resolve(this.history)
    }
    return Promise.resolve({})
  }

  tabs = () => Promise.resolve([{ targetId: 'T1', title: 'One', url: 'https://one.test/' }])
  currentTarget = () => 'T1'
  newTab = (_url: string) => Promise.resolve('T2')
  attachTo = (_id: string) => Promise.resolve()
  closeTab = (_id: string) => Promise.resolve()
  drainEvents = () => []

  methods(): string[] {
    return this.calls.map((c) => c.method)
  }

  paramsFor(method: string): Array<Record<string, unknown>> {
    return this.calls.filter((c) => c.method === method).map((c) => c.params)
  }
}

const READY: [RegExp, unknown] = [/document\.readyState/, 'complete']
const HREF: [RegExp, unknown] = [/^location\.href$/, 'https://example.test/']
const CENTRE: [RegExp, unknown] = [/getBoundingClientRect/, JSON.stringify({ x: 120, y: 240 })]

function fake(extra: Array<[RegExp, unknown]> = []): FakeCdp {
  return new FakeCdp([...extra, CENTRE, READY, HREF])
}

const run = (c: FakeCdp, name: string, args: Record<string, unknown> = {}) =>
  callTool(c as unknown as CdpClient, name, args)

describe('clicking', () => {
  it('dispatches real mouse input at the element centre', async () => {
    const c = fake()
    const out = await run(c, 'clickAt', { index: 3 })
    expect(out.isError).toBeFalsy()
    const mouse = c.paramsFor('Input.dispatchMouseEvent')
    expect(mouse.map((m) => m['type'])).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased'])
    // The coordinates come from the element's own rect, so the pointer visibly travels to what is
    // about to be clicked — which is what makes the pane watchable rather than merely live.
    expect(mouse.every((m) => m['x'] === 120 && m['y'] === 240)).toBe(true)
  })

  it('refuses an element with no size instead of clicking into the void', async () => {
    // A click at a zero-size or off-screen element is dispatched and REPORTS SUCCESS while landing
    // on whatever is behind it. The agent then believes it clicked.
    const c = new FakeCdp([[/getBoundingClientRect/, JSON.stringify({ error: 'element is not visible' })], READY, HREF])
    const out = await run(c, 'clickAt', { selector: '#hidden' })
    expect(out.isError).toBe(true)
    expect(out.content[0]?.text).toContain('not visible')
    expect(c.methods()).not.toContain('Input.dispatchMouseEvent')
  })

  it('reports a navigation, so the agent knows to re-read the page', async () => {
    const c = new FakeCdp([CENTRE, READY, [/^location\.href$/, 'https://elsewhere.test/']])
    const out = await run(c, 'clickAt', { index: 0 })
    expect(out.content[0]?.text).toContain('clicked')
  })

  it('routes the legacy `click` through the same real-input path', async () => {
    // The 27 wrappers must not be a second, weaker implementation — otherwise the same page
    // behaves differently depending on which agent is driving.
    const c = fake()
    await run(c, 'click', { selector: 'button' })
    expect(c.paramsFor('Input.dispatchMouseEvent').map((m) => m['type'])).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseReleased',
    ])
  })
})

describe('typing', () => {
  it('sends one key event pair per character, not a single insertText', async () => {
    // `Input.insertText` is one call and produces no keydown — so search suggestions, live
    // validation and anything driven by a key handler simply never fire.
    const c = fake()
    await run(c, 'typeText', { selector: 'input', text: 'abc' })
    const keys = c.paramsFor('Input.dispatchKeyEvent')
    expect(c.methods()).not.toContain('Input.insertText')
    expect(keys.filter((k) => k['type'] === 'keyDown').map((k) => k['text'])).toEqual(['a', 'b', 'c'])
  })

  it('clicks into the field first, so the text lands somewhere', async () => {
    const c = fake()
    await run(c, 'typeText', { index: 2, text: 'hi' })
    expect(c.paramsFor('Input.dispatchMouseEvent').length).toBeGreaterThan(0)
  })

  it('submits with a carriage return when asked', async () => {
    const c = fake()
    await run(c, 'typeText', { selector: 'input', text: 'q', submit: true })
    const enter = c.paramsFor('Input.dispatchKeyEvent').find((k) => k['key'] === 'Enter')
    // Without `text`, a form does not submit — the page never sees a keypress.
    expect(enter?.['text']).toBe('\r')
  })

  it('types into whatever has focus when given no target', async () => {
    const c = fake()
    await run(c, 'typeText', { text: 'x' })
    expect(c.methods()).not.toContain('Input.dispatchMouseEvent')
    expect(c.paramsFor('Input.dispatchKeyEvent').length).toBe(2)
  })
})

describe('finding things to click', () => {
  it('uses one selector string for listing and for clicking', async () => {
    // `elements` hands the model an index; `clickAt` resolves it by running the query again. If the
    // two strings ever drift, the index means a different element and a neighbouring control is
    // clicked — which reads as the model choosing wrong.
    const listing = fake()
    await run(listing, 'elements')
    const clicking = fake()
    await run(clicking, 'clickAt', { index: 1 })

    const selectorIn = (c: FakeCdp) => {
      const expr = c.paramsFor('Runtime.evaluate').map((p) => String(p['expression'])).join('\n')
      return /querySelectorAll\("([^"]+)"\)/.exec(expr)?.[1]
    }
    expect(selectorIn(listing)).toBeTruthy()
    expect(selectorIn(clicking)).toBe(selectorIn(listing))
  })

  it('filters by visible text when asked', async () => {
    const c = fake()
    await run(c, 'elements', { containing: 'Sign In' })
    const expr = c.paramsFor('Runtime.evaluate').map((p) => String(p['expression'])).join('\n')
    // Lower-cased on both sides, or "Sign In" would never match a button reading "Sign in".
    expect(expr).toContain('"sign in"')
  })
})

describe('tabs', () => {
  it('reports which tab is current', async () => {
    const c = fake()
    const out = await run(c, 'listTabs')
    expect(JSON.parse(out.content[0]!.text)).toEqual([
      { targetId: 'T1', title: 'One', url: 'https://one.test/', current: true },
    ])
  })

  it('refuses a target id it cannot see, rather than attaching to nothing', async () => {
    const c = fake()
    const out = await run(c, 'useTab', { targetId: 'ghost' })
    expect(out.isError).toBe(true)
    expect(out.content[0]?.text).toContain('listTabs')
  })
})

describe('history', () => {
  it('navigates by history entry rather than history.back()', async () => {
    // A page can trap `history.back()`. The protocol's own answer also tells us whether there WAS
    // anywhere to go, which `history.back()` never does.
    const c = fake()
    await run(c, 'back')
    expect(c.paramsFor('Page.navigateToHistoryEntry')[0]?.['entryId']).toBe(10)
  })

  it('says so when there is nowhere to go, rather than reporting a move it did not make', async () => {
    const c = fake()
    c.history = { currentIndex: 0, entries: [{ id: 10 }] }
    const out = await run(c, 'back')
    expect(out.isError).toBe(true)
    expect(out.content[0]?.text).toContain('no page to go back to')
    expect(c.methods()).not.toContain('Page.navigateToHistoryEntry')
  })
})

describe('what this browser will not pretend to do', () => {
  it('refuses the backendNodeId-shaped tools instead of approximating them', async () => {
    // These take a `backendNodeId` in the original catalog — a CDP concept with no DOM equivalent.
    // A selector-based approximation would hand the model ids that do not mean what it thinks.
    for (const name of ['tree', 'nodeDetails', 'findElement']) {
      const out = await run(fake(), name)
      expect(out.isError).toBe(true)
      expect(out.content[0]?.text).toContain('not available')
    }
  })

  it('names an unknown tool rather than failing silently', async () => {
    const out = await run(fake(), 'teleport')
    expect(out.isError).toBe(true)
    expect(out.content[0]?.text).toContain('teleport')
  })
})

import { describe, it, expect } from 'vitest'
import { callTool, sameTarget, type PageDriver } from './page-tools'

/**
 * What the agent's tools actually ask the page to do.
 *
 * The translation is where a tool quietly becomes a different tool, so the assertions below are
 * about the WIRE — which expressions were evaluated, in what order — rather than about the answer
 * coming back. A tool that returns something plausible while doing the wrong thing is the failure
 * this file exists to catch, and it is invisible from the result alone.
 */

class FakePage implements PageDriver {
  evaluated: string[] = []
  navigated: string[] = []
  /** Answers chosen by what the expression contains, first match wins. */
  constructor(private answers: Array<[RegExp, string]> = []) {}

  evaluate(expression: string): Promise<string> {
    this.evaluated.push(expression)
    for (const [pattern, value] of this.answers) {
      if (pattern.test(expression)) return Promise.resolve(value)
    }
    return Promise.resolve('')
  }

  navigate(url: string): Promise<void> {
    this.navigated.push(url)
    return Promise.resolve()
  }

  currentUrl(): Promise<string> {
    return Promise.resolve('https://example.test/')
  }

  /** Did any expression contain this? */
  saw(fragment: string): boolean {
    return this.evaluated.some((e) => e.includes(fragment))
  }
}

const READY: [RegExp, string] = [/document\.readyState/, 'complete']
const HREF: [RegExp, string] = [/^location\.href$/, 'https://example.test/']

const ELEMENTS = JSON.stringify([
  { i: 0, tag: 'a', label: 'Home' },
  { i: 1, tag: 'button', label: 'Sign in' },
  { i: 2, tag: 'input', label: 'Search the site' },
])

function page(extra: Array<[RegExp, string]> = []): FakePage {
  return new FakePage([...extra, READY, HREF])
}

const textOf = (r: { content: Array<{ text: string }> }) => r.content.map((c) => c.text).join('')

describe('the desktop-browser catalogue', () => {
  it('waits for the document before answering a navigation', async () => {
    // Returning the moment `navigate` resolves hands the NEXT tool an empty document, which the
    // model reports as "the page was blank" — a wrong answer that looks like a real observation.
    const p = page()
    await callTool(p, 'open', { url: 'https://news.ycombinator.com' })
    expect(p.navigated).toEqual(['https://news.ycombinator.com'])
    expect(p.saw('document.readyState')).toBe(true)
  })

  it('clicks through the injected helper, by index', async () => {
    const p = page()
    await callTool(p, 'clickAt', { index: 4 })
    expect(p.saw('__lmthing.click(4)')).toBe(true)
  })

  it('resolves a selector against the SAME list the helper builds', async () => {
    // `elements` hands the model an index and `clickAt` resolves it by asking for the list again.
    // If a selector were resolved against a DIFFERENT query, index 4 would mean two different
    // elements to the two calls — an off-by-one that reads as the model choosing wrong.
    const p = page([[/querySelector\(/, '2']])
    await callTool(p, 'clickAt', { selector: '#go' })
    expect(p.saw('__lmthing.click(2)')).toBe(true)
  })

  it('refuses a click it cannot place rather than clicking something else', async () => {
    const p = page([[/querySelector\(/, '-1']])
    const r = await callTool(p, 'clickAt', { selector: '#missing' })
    expect(r.isError).toBe(true)
  })

  it('filters elements by their label and caps the list', async () => {
    const p = page([[/__lmthing\.elements/, ELEMENTS]])
    const r = await callTool(p, 'elements', { containing: 'sign' })
    const list = JSON.parse(textOf(r)) as Array<{ label: string }>
    expect(list).toHaveLength(1)
    expect(list[0]?.label).toBe('Sign in')
  })

  it('waits after Enter, because Enter usually navigates', async () => {
    // A submit replaces the document. Answering before the new one exists means the next tool reads
    // the OLD page and the form appears to have done nothing.
    const p = page()
    await callTool(p, 'pressKey', { key: 'Enter' })
    expect(p.saw('__lmthing.key("Enter")')).toBe(true)
    expect(p.saw('document.readyState')).toBe(true)
  })

  it('does not wait for a key that is not Enter', async () => {
    const p = page()
    await callTool(p, 'pressKey', { key: 'Escape' })
    expect(p.saw('document.readyState')).toBe(false)
  })

  it('reports a refused back as an error instead of a silent no-op', async () => {
    // A page can trap `history.back()`, and the call returns either way. The only honest signal is
    // whether the URL actually changed.
    const p = page()
    const r = await callTool(p, 'back', {})
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(/no page to go back to/)
  })

  it('reports a back that worked', async () => {
    let calls = 0
    const p = new FakePage([
      [/^location\.href$/, ''],
      READY,
    ])
    // First read is the old URL, second is the new one.
    p.evaluate = (expression: string) => {
      ;(p.evaluated as string[]).push(expression)
      if (/^location\.href$/.test(expression)) return Promise.resolve(++calls === 1 ? '/a' : '/b')
      if (/readyState/.test(expression)) return Promise.resolve('complete')
      return Promise.resolve('')
    }
    const r = await callTool(p, 'back', {})
    expect(r.isError).toBeFalsy()
  })
})

describe('a url argument means go there first', () => {
  it('navigates before reading, for a tool that is not goto', async () => {
    // THE bug this suite exists for. Asked for markdown of google.com, an implementation that
    // ignores `url` reads whatever is loaded and returns it as the answer. It happened in the
    // product: the model got the default landing page, noticed it was not Google, and explained it
    // away as a privacy extension redirecting the request — a coherent account of something that
    // never occurred. Nothing errored, because from the DOM's side nothing was wrong.
    const p = new FakePage([[/__lmthing\.text/, 'Google home'], READY, [/^location\.href$/, 'https://duckduckgo.com/']])
    await callTool(p, 'markdown', { url: 'https://www.google.com' })
    expect(p.navigated).toEqual(['https://www.google.com'])
  })

  it.each(['html', 'links', 'structuredData', 'elements'])('honours url on %s too', async (name) => {
    const p = new FakePage([READY, [/^location\.href$/, 'https://elsewhere.test/']])
    await callTool(p, name, { url: 'https://target.test/page' })
    expect(p.navigated).toEqual(['https://target.test/page'])
  })

  it('does not re-navigate when it is already there', async () => {
    // A redundant navigation is not harmless: it throws away the page state the previous calls
    // built up — a filled form, a scroll position, an expanded menu.
    const p = new FakePage([READY, [/^location\.href$/, 'https://example.test/']])
    await callTool(p, 'markdown', { url: 'https://www.example.test' })
    expect(p.navigated).toEqual([])
  })

  it('treats trailing slash and www as the same place, and a query as different', () => {
    expect(sameTarget('https://example.com/', 'https://example.com')).toBe(true)
    expect(sameTarget('https://www.example.com/', 'https://example.com/')).toBe(true)
    expect(sameTarget('https://example.com/a', 'https://example.com/b')).toBe(false)
    expect(sameTarget('https://example.com/?q=1', 'https://example.com/')).toBe(false)
    expect(sameTarget('about:blank', 'https://example.com')).toBe(false)
  })
})

describe('a selector argument means read THAT part', () => {
  it('scopes markdown to the selector', async () => {
    const p = page([[/querySelector/, 'just the article']])
    const r = await callTool(p, 'markdown', { selector: 'article' })
    expect(textOf(r)).toBe('just the article')
  })

  it('reports a selector that matches nothing instead of returning the whole page', async () => {
    // Same family as the `url` bug: answered with something plausible, a model cannot tell it was
    // not answered at all.
    const p = page([[/querySelector/, '\u0000notfound']])
    const r = await callTool(p, 'html', { selector: '#missing' })
    expect(r.isError).toBe(true)
  })
})

describe('what this browser cannot do, it says so', () => {
  it('answers listTabs truthfully with the one page there is', async () => {
    // The pane shows one page. Inventing tabs would have the model plan around something that does
    // not exist, and the plan would fail somewhere else entirely.
    const r = await callTool(page(), 'listTabs', {})
    const tabs = JSON.parse(textOf(r)) as Array<{ current: boolean }>
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.current).toBe(true)
  })

  it.each(['openTab', 'useTab', 'closeTab'])('refuses %s and says what to use instead', async (name) => {
    const r = await callTool(page(), name, {})
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(/use open/i)
  })

  it.each(['tree', 'nodeDetails', 'findElement'])('refuses %s rather than approximating it', async (name) => {
    // These are `backendNodeId`-shaped and that id space does not exist here. A selector-based
    // approximation would hand the model ids that do not mean what it thinks they mean.
    const r = await callTool(page(), name, {})
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(/elements/)
  })

  it('says out loud that it cannot see HttpOnly cookies', async () => {
    // The shortfall has to be IN the answer. An agent handed a partial cookie list with no note
    // reports it as the whole one — and the session cookies are exactly the HttpOnly ones.
    const p = page([[/document\.cookie/, JSON.stringify('a=1')]])
    const r = await callTool(p, 'getCookies', {})
    expect(textOf(r)).toMatch(/HttpOnly/)
  })

  it('times out waiting for a selector, as an error', async () => {
    const p = page([[/querySelector/, 'false']])
    const r = await callTool(p, 'waitFor', { selector: '#never', timeout: 300 })
    expect(r.isError).toBe(true)
  })

  it('rejects an unknown tool by name', async () => {
    const r = await callTool(page(), 'teleport', {})
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(/teleport/)
  })
})

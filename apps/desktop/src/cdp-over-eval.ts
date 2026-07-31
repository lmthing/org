import type { PageDriver, ToolResult } from './page-tools'

/**
 * The CDP interface, kept — and answered with JavaScript.
 *
 * ## Why keep it at all
 *
 * The pane is an OS webview now, and only WebView2 speaks the Chrome DevTools Protocol. The
 * tempting move was to refuse `cdp()` outright on the other two platforms. That is worse than it
 * looks: the devtools agent's whole surface is written in CDP, the store of knowledge about how to
 * drive a page is written in CDP, and a capability that exists but always fails is the one shape
 * this codebase argues hardest against.
 *
 * Most of what agents actually reach for is expressible. `Runtime.evaluate` IS evaluation.
 * `Page.navigate` is a navigation. `Input.dispatchMouseEvent` at a point is a hit-test and a
 * dispatched event. So those are translated, and the caller gets the answer shape the protocol
 * promises.
 *
 * ## Where it stops, and why it says so
 *
 * Anything built on `backendNodeId` — `DOM.*`, `Accessibility.*` — cannot be translated, because
 * that id space is a property of the protocol's own view of the document and does not exist in a
 * webview. There is no honest approximation: handing back a synthesised id would let a model build
 * a plan on ids that do not mean what it thinks, and every failure after that would be attributed
 * to the wrong thing. Those are refused BY NAME, with what to use instead.
 *
 * The refusals are the load-bearing part of this file. A translation layer that quietly does
 * something adjacent is far more damaging than one that admits a gap.
 */

export interface CdpAnswer {
  ok: boolean
  result?: unknown
  error?: string
}

/** Methods that are genuinely the same operation under a different name. */
const TRANSLATED = new Set([
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Page.navigate',
  'Page.reload',
  'Page.getNavigationHistory',
  'Page.navigateToHistoryEntry',
  'Page.getLayoutMetrics',
  'Network.getCookies',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Emulation.setDeviceMetricsOverride',
  'Emulation.setFocusEmulationEnabled',
  'Target.getTargets',
])

/**
 * Domains whose whole point is the protocol's private view of the document.
 *
 * Listed as a prefix rather than method-by-method deliberately: a new `DOM.*` method added to the
 * protocol tomorrow is just as untranslatable as the ones here, and a list of individual names
 * would silently fall through to "unknown method" instead of explaining why.
 */
const UNTRANSLATABLE: Array<[string, string]> = [
  ['DOM.', 'DOM nodes are addressed by backendNodeId, which does not exist in a webview. Use Runtime.evaluate with a CSS selector.'],
  ['Accessibility.', 'The accessibility tree is not exposed by a webview. Use Runtime.evaluate to read the DOM.'],
  ['DOMDebugger.', 'Breakpoints are not available in a webview.'],
  ['Debugger.', 'The JavaScript debugger is not available in a webview.'],
  ['Profiler.', 'The profiler is not available in a webview.'],
  ['Fetch.', 'Request interception is not available in a webview.'],
  ['Network.enable', 'Network events are not available in a webview; only Network.getCookies is answerable.'],
]

export async function cdpViaEval(
  page: PageDriver,
  method: string,
  params: Record<string, unknown> = {},
): Promise<CdpAnswer> {
  for (const [prefix, why] of UNTRANSLATABLE) {
    if (method.startsWith(prefix)) return { ok: false, error: `${method} — ${why}` }
  }
  if (!TRANSLATED.has(method)) {
    return {
      ok: false,
      error: `${method} is not available on the desktop browser, which is an OS webview rather than Chromium. Runtime.evaluate, Page.navigate, Input.* and Network.getCookies are.`,
    }
  }

  const json = async <T>(expr: string, fallback: T): Promise<T> => {
    try {
      return JSON.parse(await page.evaluate(expr)) as T
    } catch {
      return fallback
    }
  }

  switch (method) {
    case 'Runtime.evaluate': {
      const expression = String(params['expression'] ?? '')
      const value = await page.evaluate(expression)
      // The protocol's own shape, so a caller written against CDP needs no special case here.
      return { ok: true, result: { result: { value: parseMaybe(value) } } }
    }
    case 'Runtime.callFunctionOn': {
      const fn = String(params['functionDeclaration'] ?? '')
      const value = await page.evaluate(`(${fn}).call(globalThis)`)
      return { ok: true, result: { result: { value: parseMaybe(value) } } }
    }
    case 'Page.navigate': {
      await page.navigate(String(params['url'] ?? ''))
      return { ok: true, result: { frameId: 'pane' } }
    }
    case 'Page.reload': {
      await page.evaluate('location.reload()')
      return { ok: true, result: {} }
    }
    case 'Page.getNavigationHistory': {
      // `history.length` is all a page may know — the entries themselves are deliberately not
      // readable by script. So the shape is honest about what it does not have: the current index
      // and a count, with no URLs to pretend otherwise.
      const length = Number(await page.evaluate('history.length')) || 1
      const here = await page.evaluate('location.href').catch(() => '')
      return {
        ok: true,
        result: {
          currentIndex: length - 1,
          entries: Array.from({ length }, (_, i) => ({ id: i, url: i === length - 1 ? here : null })),
          note: 'a webview cannot read its history entries; only the count is real',
        },
      }
    }
    case 'Page.navigateToHistoryEntry': {
      const id = Number(params['entryId'] ?? 0)
      const length = Number(await page.evaluate('history.length')) || 1
      await page.evaluate(`history.go(${id - (length - 1)})`)
      return { ok: true, result: {} }
    }
    case 'Page.getLayoutMetrics': {
      const m = await json(
        `JSON.stringify({cssVisualViewport:{clientWidth:innerWidth,clientHeight:innerHeight,pageX:scrollX,pageY:scrollY},cssContentSize:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}})`,
        {},
      )
      return { ok: true, result: m }
    }
    case 'Network.getCookies': {
      const raw = await page.evaluate('document.cookie')
      const cookies = String(raw)
        .split(';')
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
          const eq = pair.indexOf('=')
          return { name: pair.slice(0, eq), value: pair.slice(eq + 1) }
        })
      // The gap is named in the answer. `document.cookie` cannot see HttpOnly, and those are
      // precisely the session cookies — an agent handed a partial list with no note reports it as
      // the whole one.
      return {
        ok: true,
        result: { cookies, note: 'document.cookie only — HttpOnly cookies are invisible to a webview' },
      }
    }
    case 'Input.dispatchMouseEvent': {
      const type = String(params['type'] ?? '')
      // Only the press is acted on: CDP callers send moved/pressed/released as three calls, and
      // dispatching a click for each would click three times.
      if (type !== 'mousePressed') return { ok: true, result: {} }
      const x = Number(params['x'] ?? 0)
      const y = Number(params['y'] ?? 0)
      const out = await page.evaluate(
        `(()=>{const e=document.elementFromPoint(${x},${y});if(!e)return 'no element at point';` +
          `e.scrollIntoView&&0;e.focus&&e.focus();e.click();return 'clicked'})()`,
      )
      return out.includes('no element')
        ? { ok: false, error: `nothing at (${x}, ${y})` }
        : { ok: true, result: {} }
    }
    case 'Input.dispatchKeyEvent': {
      if (String(params['type'] ?? '') !== 'keyDown') return { ok: true, result: {} }
      const key = String(params['key'] ?? params['text'] ?? '')
      await page.evaluate(`JSON.stringify(window.__lmthing.key(${JSON.stringify(key)}))`)
      return { ok: true, result: {} }
    }
    case 'Input.insertText': {
      const value = String(params['text'] ?? '')
      await page.evaluate(
        `(()=>{const e=document.activeElement;if(!e)return 'none';` +
          `e.value=(e.value||'')+${JSON.stringify(value)};` +
          `e.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()`,
      )
      return { ok: true, result: {} }
    }
    case 'Emulation.setDeviceMetricsOverride':
    case 'Emulation.setFocusEmulationEnabled':
      // Accepted and ignored. The pane is a real view sized by the window and focused by the
      // person, so these describe things that are already true — and failing them would break
      // callers that send them as setup before doing something that DOES work.
      return { ok: true, result: {} }
    case 'Target.getTargets': {
      const info = await json<{ url?: string; title?: string }>(
        'JSON.stringify({url:location.href,title:document.title})',
        {},
      )
      return {
        ok: true,
        result: {
          targetInfos: [
            { targetId: 'pane', type: 'page', url: info.url ?? '', title: info.title ?? '', attached: true },
          ],
        },
      }
    }
    default:
      return { ok: false, error: `${method} is not available on the desktop browser` }
  }
}

/** A JSON value if it is one, the raw string otherwise. */
function parseMaybe(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export type { ToolResult }

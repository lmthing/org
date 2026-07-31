// Injected into every page in the browser pane, before any page script, on every navigation.
//
// Deliberately tiny, and it holds no state that matters. Everything the agent asks for is
// evaluated fresh through `Webview::eval_with_callback`; this file exists only so that the
// *definition* of "the interactive elements on this page" lives in ONE place. When the agent asks
// for a list and then asks to click item 4, both calls must mean the same thing by "item 4" — two
// selector strings that drifted apart produce an off-by-one that clicks a neighbouring control,
// which reads as the model choosing wrong rather than as a bug here.
//
// It runs in the page's own world, so it must not assume anything about the page and must not
// leave anything a page could trip over beyond one namespaced global.
(() => {
  if (window.__lmthing) return
  const SELECTOR = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [onclick], [contenteditable="true"]'

  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
  }

  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim()
    return t.replace(/\s+/g, ' ').slice(0, 120)
  }

  const list = () => Array.from(document.querySelectorAll(SELECTOR)).filter(visible)

  window.__lmthing = {
    // The page as the model should read it: text, not markup. `innerText` respects what is
    // actually rendered — hidden nodes and `display:none` are excluded — which `textContent` does
    // not, and the difference is a page full of navigation boilerplate the person cannot see.
    text: (max) => (document.body ? document.body.innerText.slice(0, max || 40000) : ''),

    elements: () =>
      list().map((el, i) => ({
        i,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || undefined,
        label: label(el),
        href: el.getAttribute('href') || undefined,
      })),

    // Same list, same order, same index — see the note at the top of this file.
    click: (i) => {
      const el = list()[i]
      if (!el) return { ok: false, error: `no element ${i}` }
      el.scrollIntoView({ block: 'center', inline: 'center' })
      // Focus first: a click on a control that never received focus skips the focus/blur handlers
      // real interaction fires, which is what validation and comboboxes hang off.
      if (typeof el.focus === 'function') el.focus()
      el.click()
      return { ok: true, label: label(el) }
    },

    type: (i, value) => {
      const el = list()[i]
      if (!el) return { ok: false, error: `no element ${i}` }
      el.focus()
      const setter = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set
      // Assigning `.value` directly does not notify a framework that tracks it — React overrides
      // the property, so the component's state never learns and the field reverts on the next
      // render. Calling the NATIVE setter and then dispatching is what every testing library does,
      // for exactly this reason.
      if (setter) setter.call(el, value)
      else el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true }
    },

    scrollBy: (dy) => {
      window.scrollBy(0, dy)
      return { ok: true, y: window.scrollY }
    },

    // A key, sent to whatever has focus. `KeyboardEvent` is not a real key press and pages can
    // tell, but it is what a webview allows — there is no `Input.dispatchKeyEvent` here. The one
    // case worth special-casing is Enter in a form, which is overwhelmingly what this is used for
    // and which a synthetic keydown alone does NOT submit.
    key: (name) => {
      const el = document.activeElement || document.body
      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(
          new KeyboardEvent(type, { key: name, code: name, bubbles: true, cancelable: true }),
        )
      }
      if (name === 'Enter') {
        const form = el.closest && el.closest('form')
        if (form) {
          if (typeof form.requestSubmit === 'function') form.requestSubmit()
          else form.submit()
          return { ok: true, submitted: true }
        }
      }
      return { ok: true }
    },

    info: () => ({
      url: location.href,
      title: document.title,
      ready: document.readyState,
      scrollY: window.scrollY,
      scrollHeight: document.body ? document.body.scrollHeight : 0,
    }),

    logs: () => window.__lmthing_logs.slice(),
  }

  // Console capture. A webview has no protocol-level console feed the way CDP does, so the only
  // way an agent can see what a page logged is to be listening before the page runs — which is
  // exactly when this script executes. Bounded, because a page in a logging loop would otherwise
  // grow this without limit.
  const LOG_LIMIT = 200
  window.__lmthing_logs = []
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console)
    console[level] = (...args) => {
      try {
        window.__lmthing_logs.push({
          level,
          at: Date.now(),
          text: args
            .map((a) => {
              try {
                return typeof a === 'string' ? a : JSON.stringify(a)
              } catch {
                return String(a)
              }
            })
            .join(' ')
            .slice(0, 2000),
        })
        if (window.__lmthing_logs.length > LOG_LIMIT) window.__lmthing_logs.shift()
      } catch {
        /* never let logging break the page */
      }
      original(...args)
    }
  }
})()

import { invoke } from '@tauri-apps/api/core'
import type { PageDriver } from './page-tools'

/**
 * The [`PageDriver`] the agent's tools run against: the webview pane, over Tauri commands.
 *
 * Thin by design. Everything interesting is in `page-tools.ts`, which takes the driver as an
 * interface so the catalogue can be tested without a window — and so the one place that knows how
 * to reach the pane is this file.
 */
export const panePage: PageDriver = {
  /**
   * Evaluate in the page and hand back the JSON the expression produced.
   *
   * `Webview::eval_with_callback` serialises the value for us, so a string comes back quoted. The
   * callers here want the value, not its JSON encoding, so a lone string is unwrapped — otherwise
   * every `document.readyState` comparison is against `"complete"` with the quotes included, which
   * is the kind of bug that only shows up as a timeout.
   */
  async evaluate(expression: string): Promise<string> {
    const raw = await invoke<string>('browserview_eval', { js: expression })
    if (typeof raw !== 'string') return String(raw)
    const trimmed = raw.trim()
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return String(JSON.parse(trimmed))
      } catch {
        return raw
      }
    }
    return raw
  },

  async navigate(url: string): Promise<void> {
    await invoke('browserview_navigate', { url })
  },

  async currentUrl(): Promise<string> {
    const state = await invoke<{ url?: string }>('browserview_state')
    return state?.url ?? ''
  },
}

/**
 * Make sure the pane exists before an agent tries to use it.
 *
 * An agent may reach for the browser when the person has never opened it. Opening it on their
 * behalf is right — they asked for a web page — but it must be VISIBLE when it happens, which is
 * why this asks the app to show the pane rather than quietly creating an offscreen view. A browser
 * an agent drives where nobody can see it is the one thing this design exists to avoid.
 */
export async function ensurePaneOpen(): Promise<void> {
  const state = await invoke<{ open?: boolean }>('browserview_state').catch(() => null)
  if (state?.open) return
  // The shell owns the split, so it is asked rather than told: `WebviewPane` places the view once
  // the layout has somewhere to put it.
  window.dispatchEvent(new CustomEvent('lmthing://open-browser'))
  // Give the pane a moment to mount and report its rectangle. Polled rather than a fixed wait,
  // because on a cold start this is a render and on a warm one it is immediate.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const now = await invoke<{ open?: boolean }>('browserview_state').catch(() => null)
    if (now?.open) return
  }
  throw new Error('the browser pane did not open')
}

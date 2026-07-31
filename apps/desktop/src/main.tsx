import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { hydrateAuth } from '@lmthing/auth'
import '@lmthing/ui/chat/css'
import { installSsoHandler } from './desktop'
import { App } from './App'

/**
 * Boot order, which is the one thing this file owns.
 *
 * 1. `installSsoHandler()` — before anything can render a login button.
 * 2. `await hydrateAuth()` — a no-op on web today, but awaited anyway. `getSession()` is
 *    synchronous by contract, and the moment the session moves into the OS keychain (the planned
 *    hardening) it will be answered from a cache this fills. Rendering before it resolves paints a
 *    logged-out app to a logged-in person and then flips. `apps/mobile` learned this; doing it now
 *    makes that change a store swap rather than an app rewrite.
 * 3. Mount.
 */
async function boot(): Promise<void> {
  installSsoHandler()
  // Never rejects — an unreadable keystore entry is "logged out", not a boot loop.
  await hydrateAuth()

  const el = document.getElementById('root')
  if (!el) throw new Error('#root missing from index.html')
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

/**
 * A boot failure must never be a blank window.
 *
 * There is no address bar here, no reload button and no devtools in a packaged build, so an
 * exception escaping `boot()` leaves a person staring at an empty frame with no way to learn
 * anything or do anything. This is the last line of defence: whatever went wrong, say so on screen.
 *
 * Deliberately plain DOM and not a component — if the React tree were healthy enough to render, we
 * would not be here.
 */
void boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[desktop] boot failed', err)
  const el = document.getElementById('root')
  if (!el) return
  const pre = document.createElement('pre')
  pre.textContent = `lmthing could not start.\n\n${message}`
  // No design tokens: the stylesheet is part of what may have failed to load, and `lint:tokens`
  // permits an achromatic value. Legibility in both themes matters more than theming here.
  pre.setAttribute('style', 'padding:24px;font:14px/1.5 monospace;white-space:pre-wrap')
  el.appendChild(pre)
})

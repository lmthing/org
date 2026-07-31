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

void boot()

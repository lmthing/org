import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter, createBrowserHistory } from '@tanstack/react-router'
import type { RouterHistory, HistoryLocation } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { surfaceForHost, foreignSurfaceRedirect } from './routes/index'

const DOMAIN_HOSTS = new Set(['lmthing.computer', 'lmthing.chat', 'lmthing.studio', 'lmthing.app'])

/**
 * Top-level routes that must NOT receive the surface prefix — they are served by the
 * shell at their literal path on the domain host. On lmthing.app the store redirects
 * to `/install?appId=…` (Envoy reserves `/install` for the shell), so prefixing it to
 * `/apps/install` would 404 the install flow. Harmless on the other domains (they never
 * navigate here).
 */
const RESERVED_TOPLEVEL = new Set(['/install'])

/**
 * On domain-specific hosts (lmthing.computer, lmthing.app, …) the surface prefix is
 * implicit in the hostname. This history wrapper makes TanStack Router see paths with
 * the prefix (so /computer/dashboard routes correctly, and lmthing.app's launcher at
 * internal /apps shows as browser /) while the browser URL stays clean.
 */
function createPrefixedHistory(prefix: string): RouterHistory {
  const base = createBrowserHistory()

  const addPrefix = (pathname: string): string =>
    pathname.startsWith(prefix) || RESERVED_TOPLEVEL.has(pathname)
      ? pathname
      : prefix + (pathname === '/' ? '' : pathname)

  const addPrefixToHref = (href: string): string => {
    const qi = href.indexOf('?'), hi = href.indexOf('#')
    const end = qi !== -1 ? qi : hi !== -1 ? hi : href.length
    const pathname = href.slice(0, end)
    return addPrefix(pathname) + href.slice(end)
  }

  const stripPrefixFromHref = (href: string): string => {
    const qi = href.indexOf('?'), hi = href.indexOf('#')
    const end = qi !== -1 ? qi : hi !== -1 ? hi : href.length
    const pathname = href.slice(0, end)
    const stripped = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || '/' : pathname
    return stripped + href.slice(end)
  }

  const patchLoc = (loc: HistoryLocation): HistoryLocation => ({
    ...loc,
    pathname: addPrefix(loc.pathname),
    href: addPrefixToHref(loc.href),
  })

  return {
    ...base,
    get location() { return patchLoc(base.location) },
    subscribe(cb) {
      return base.subscribe(({ location, action }) => cb({ location: patchLoc(location), action }))
    },
    push(path, state, opts) { base.push(stripPrefixFromHref(path), state, opts) },
    replace(path, state, opts) { base.replace(stripPrefixFromHref(path), state, opts) },
    createHref(href) { return base.createHref(stripPrefixFromHref(href)) },
  }
}

const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
const history = DOMAIN_HOSTS.has(hostname)
  ? createPrefixedHistory(surfaceForHost(hostname))
  : createBrowserHistory()

const router = createRouter({ routeTree, history })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Production-only cross-domain surface redirect. A foreign surface path landing on the
// wrong product domain (e.g. lmthing.chat/studio/…) is bounced to its canonical domain
// BEFORE the router mounts — otherwise the prefixed history above would rewrite it to a
// non-existent internal route (/chat/studio/…) and 404. `location.replace` is the
// client-side equivalent of a 302: no history entry (no back-button trap) and uncached.
// Locally (localhost / *.test) `foreignSurfaceRedirect` returns null, so these paths stay
// client-side routes and local links keep working.
const redirectTarget =
  typeof window !== 'undefined' ? foreignSurfaceRedirect(window.location) : null

if (redirectTarget) {
  window.location.replace(redirectTarget)
} else {
  const rootElement = document.getElementById('root')!

  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

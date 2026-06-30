import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter, createBrowserHistory } from '@tanstack/react-router'
import type { RouterHistory, HistoryLocation } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { surfaceForHost } from './routes/index'

const DOMAIN_HOSTS = new Set(['lmthing.computer', 'lmthing.chat', 'lmthing.studio'])

/**
 * On domain-specific hosts (lmthing.computer etc.) the surface prefix is implicit
 * in the hostname. This history wrapper makes TanStack Router see paths with the
 * prefix (so /computer/dashboard routes correctly) while the browser URL stays
 * clean (shows /dashboard, not /computer/dashboard).
 */
function createPrefixedHistory(prefix: string): RouterHistory {
  const base = createBrowserHistory()

  const addPrefix = (pathname: string): string =>
    pathname.startsWith(prefix) ? pathname : prefix + (pathname === '/' ? '' : pathname)

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

const rootElement = document.getElementById('root')!

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

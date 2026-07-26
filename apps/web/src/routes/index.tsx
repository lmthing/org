import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuth } from '@lmthing/auth'

export type Surface = '/chat' | '/studio' | '/computer' | '/apps' | '/team'

const HOST_SURFACE: Record<string, Surface> = {
  'lmthing.chat': '/chat',
  'lmthing.studio': '/studio',
  'lmthing.computer': '/computer',
  'lmthing.app': '/apps',
  'lmthing.team': '/team',
}

/**
 * The unified-app surface for a hostname: lmthing.chat → /chat,
 * lmthing.studio → /studio, lmthing.computer → /computer, lmthing.app → /apps
 * (the app launcher), lmthing.team → /team (a team's shared workspace). On lmthing.app the prefixed history shows this surface at a
 * clean browser `/`, and installed apps open at the pod's mount — clean
 * `/<project>/` in prod (Envoy catch-all → pod), `/app/<project>/` on localhost.
 * Unknown hosts (localhost, the `*.test` dev proxy, …) fall back to /studio.
 * Each product domain is served the same unified app statically; the surface is
 * chosen client-side, here, from the hostname.
 */
export function surfaceForHost(host: string): Surface {
  return HOST_SURFACE[host] ?? '/studio'
}

/**
 * URL-path prefix → the production host that owns that surface. This is the reverse
 * of `HOST_SURFACE`, keyed by the prefix a link actually carries: the app launcher's
 * URL prefix is `/app` (installed apps, e.g. `/app/blog`) even though its internal
 * route is `/apps`.
 */
const PREFIX_HOST: Record<string, string> = {
  '/chat': 'lmthing.chat',
  '/studio': 'lmthing.studio',
  '/computer': 'lmthing.computer',
  '/app': 'lmthing.app',
  '/team': 'lmthing.team',
}

/** The production domain hosts — each serves the same unified app. */
const PROD_HOSTS: ReadonlySet<string> = new Set(Object.values(PREFIX_HOST))

/**
 * Production-only cross-domain redirect. Each product domain serves the same SPA and
 * shows only its own surface, so a foreign surface path that lands on the wrong domain
 * (e.g. `lmthing.chat/studio/foo` — a typed or stale link) belongs on another domain.
 * Returns the absolute URL to bounce it there with the prefix stripped, or `null` when
 * no redirect is needed:
 *   - the host is not a production domain (localhost / `*.test` → paths stay client-side
 *     routes, so local links keep working),
 *   - the path's surface already matches the current domain (same-surface prefix), or
 *   - the path is not a surface path at all (`/`, `/settings`, `/install`, `/?code=…`, …).
 * Query string and hash are preserved. The caller navigates with `location.replace`.
 */
export function foreignSurfaceRedirect(loc: {
  hostname: string
  pathname: string
  search: string
  hash: string
}): string | null {
  if (!PROD_HOSTS.has(loc.hostname)) return null
  for (const [prefix, host] of Object.entries(PREFIX_HOST)) {
    // Match only on a segment boundary so `/computerish` never matches `/computer`.
    if (loc.pathname !== prefix && !loc.pathname.startsWith(prefix + '/')) continue
    if (host === loc.hostname) return null // already on the surface's own domain
    const rest = loc.pathname.slice(prefix.length) || '/'
    return `https://${host}${rest}${loc.search}${loc.hash}`
  }
  return null
}

/** True while an OAuth callback is being processed at the root (`/?code=…&state=…`). */
function isAuthCallback(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code')
}

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // The SSO callback (default `callbackPath: '/'`) lands here as `/?code=…&state=…`.
    // Do NOT redirect it to the surface — that navigation drops the `?code` before
    // @lmthing/auth (mounted in the root) can exchange it, leaving the user stuck on the
    // login screen. Render the waiter instead; it forwards to the surface once auth settles.
    if (isAuthCallback()) return
    const host = typeof window !== 'undefined' ? window.location.hostname : ''
    throw redirect({ to: surfaceForHost(host), replace: true })
  },
  component: RootRedirect,
})

/** Shown only during an SSO callback: waits for @lmthing/auth to finish exchanging the
 *  code (it clears `?code` and flips `isLoading`), then forwards to this host's surface
 *  (authenticated → the surface content; still not → the surface's own login gate). */
function RootRedirect() {
  const navigate = useNavigate()
  const { isLoading, isAuthenticated } = useAuth()
  useEffect(() => {
    if (isLoading) return
    // Resume a pending install captured before login (store → install → sign in).
    if (isAuthenticated && typeof window !== 'undefined') {
      const pendingSpace = sessionStorage.getItem('lmthing_pending_install_space')
      if (pendingSpace) {
        sessionStorage.removeItem('lmthing_pending_install_space')
        navigate({ to: '/install', search: { spaceId: pendingSpace, appId: '' }, replace: true })
        return
      }
      const pending = sessionStorage.getItem('lmthing_pending_install')
      if (pending) {
        sessionStorage.removeItem('lmthing_pending_install')
        navigate({ to: '/install', search: { appId: pending, spaceId: '' }, replace: true })
        return
      }
    }
    const host = typeof window !== 'undefined' ? window.location.hostname : ''
    navigate({ to: surfaceForHost(host), replace: true })
  }, [isLoading, isAuthenticated, navigate])
  return (
    <Prim.Box display="flex" height="100%" alignItems="center" justifyContent="center" fontSize="$sm" color="$muted-foreground">
      Signing you in…
    </Prim.Box>
  )
}

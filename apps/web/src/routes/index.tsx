import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuth } from '@lmthing/auth'

const HOST_SURFACE: Record<string, '/chat' | '/studio' | '/computer' | '/apps'> = {
  'lmthing.chat': '/chat',
  'lmthing.studio': '/studio',
  'lmthing.computer': '/computer',
  'lmthing.app': '/apps',
}

/**
 * The unified-app surface for a hostname: lmthing.chat → /chat,
 * lmthing.studio → /studio, lmthing.computer → /computer, lmthing.app → /apps
 * (the app launcher). On lmthing.app the prefixed history shows this surface at a
 * clean browser `/`, and installed apps open at the pod's mount — clean
 * `/<project>/` in prod (Envoy catch-all → pod), `/app/<project>/` on localhost.
 * Unknown hosts (localhost, the `*.test` dev proxy, …) fall back to /studio.
 * Each product domain is served the same unified app statically; the surface is
 * chosen client-side, here, from the hostname.
 */
export function surfaceForHost(host: string): '/chat' | '/studio' | '/computer' | '/apps' {
  return HOST_SURFACE[host] ?? '/studio'
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
      const pending = sessionStorage.getItem('lmthing_pending_install')
      if (pending) {
        sessionStorage.removeItem('lmthing_pending_install')
        navigate({ to: '/install', search: { appId: pending }, replace: true })
        return
      }
    }
    const host = typeof window !== 'undefined' ? window.location.hostname : ''
    navigate({ to: surfaceForHost(host), replace: true })
  }, [isLoading, isAuthenticated, navigate])
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Signing you in…
    </div>
  )
}

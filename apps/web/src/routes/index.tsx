import { createFileRoute, redirect } from '@tanstack/react-router'

const HOST_SURFACE: Record<string, '/chat' | '/studio' | '/computer'> = {
  'lmthing.chat': '/chat',
  'lmthing.studio': '/studio',
  'lmthing.computer': '/computer',
}

/**
 * The unified-app surface for a hostname: lmthing.chat → /chat,
 * lmthing.studio → /studio, lmthing.computer → /computer. Unknown hosts
 * (localhost, the `*.test` dev proxy, …) fall back to /studio. Each product
 * domain is served the same unified app statically; the surface is chosen
 * client-side, here, from the hostname.
 */
export function surfaceForHost(host: string): '/chat' | '/studio' | '/computer' {
  return HOST_SURFACE[host] ?? '/studio'
}

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const host = typeof window !== 'undefined' ? window.location.hostname : ''
    throw redirect({ to: surfaceForHost(host), replace: true })
  },
})

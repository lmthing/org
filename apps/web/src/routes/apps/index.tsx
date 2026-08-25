import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/apps` — the former app launcher, now a REDIRECT into the chat surface.
 *
 * There is no separate app surface anymore: every project is a served app from birth (a chat page
 * that grows), and selecting one loads its app INSIDE `/chat`. So the launcher grid is gone — landing
 * on `/apps` (the lmthing.app surface) forwards to `/chat`, which resolves the default project. The
 * one thing kept alive is the store-install resume: store → `/install` → sign in lands back here on
 * lmthing.app (the SSO callback returns to the prefixed surface), so a pending install is forwarded
 * to `/install` before we fall through to `/chat`.
 */
export const Route = createFileRoute('/apps/')({
  beforeLoad: () => {
    if (typeof window !== 'undefined') {
      const space = sessionStorage.getItem('lmthing_pending_install_space')
      if (space) {
        sessionStorage.removeItem('lmthing_pending_install_space')
        throw redirect({ to: '/install', search: { spaceId: space, appId: '' } })
      }
      const app = sessionStorage.getItem('lmthing_pending_install')
      if (app) {
        sessionStorage.removeItem('lmthing_pending_install')
        throw redirect({ to: '/install', search: { appId: app, spaceId: '' } })
      }
    }
    throw redirect({ to: '/chat' })
  },
})

/**
 * Cross-app links for the lmthing product suite (studio / chat / computer).
 *
 * All three surfaces now live as routes inside ONE served app (pod CLI), so a
 * cross-app hop is a client-side route change on the same origin:
 *   studio → /studio, chat → /chat, computer → /computer.
 *
 * `appUrl` still resolves an explicit absolute origin via Vite env
 * (VITE_STUDIO_URL / VITE_CHAT_URL / VITE_COMPUTER_URL) for callers that need
 * the standalone per-host origin, but the cross-app switcher links use the
 * relative route paths below.
 */
export type LmthingApp = 'studio' | 'chat' | 'computer'

interface ViteEnv {
  DEV?: boolean
  VITE_STUDIO_URL?: string
  VITE_CHAT_URL?: string
  VITE_COMPUTER_URL?: string
}

function readEnv(): ViteEnv {
  try {
    return (import.meta as unknown as { env?: ViteEnv }).env ?? {}
  } catch {
    return {}
  }
}

const ENV_KEY: Record<LmthingApp, keyof ViteEnv> = {
  studio: 'VITE_STUDIO_URL',
  chat: 'VITE_CHAT_URL',
  computer: 'VITE_COMPUTER_URL',
}

/** Absolute origin for one of the lmthing apps (explicit env override only). */
export function appUrl(app: LmthingApp): string {
  const env = readEnv()
  const override = env[ENV_KEY[app]] as string | undefined
  if (override) return override
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:'
  return env.DEV ? `${protocol}//${app}.test` : `https://lmthing.${app}`
}

/** Relative in-app route path for one of the unified surfaces. */
export function appRoute(app: LmthingApp): string {
  return `/${app}`
}

/**
 * Origin prefix for cross-surface navigation, chosen by environment:
 *  - **Production** — each surface is served from its own `lmthing.<app>` domain,
 *    so we return the absolute origin `https://lmthing.<app>`.
 *  - **Local / unified** — all surfaces are routes on one origin, so we return
 *    `''` and callers navigate via the relative route path (`/studio`, `/chat`…).
 *
 * An explicit `VITE_<APP>_URL` override always wins (used by standalone hosts).
 */
export function crossAppOrigin(app: LmthingApp): string {
  const override = readEnv()[ENV_KEY[app]] as string | undefined
  if (override) return override.replace(/\/$/, '')
  if (typeof window === 'undefined') return ''
  if (window.location.hostname.startsWith('lmthing.')) return `https://lmthing.${app}`
  return ''
}

export interface AppLink {
  app: LmthingApp
  label: string
  emoji: string
  url: string
}

const APP_META: Record<LmthingApp, { label: string; emoji: string }> = {
  studio: { label: 'Studio', emoji: '🎛️' },
  chat: { label: 'Chat', emoji: '💬' },
  computer: { label: 'Computer', emoji: '🖥️' },
}

/**
 * Links to the *other* unified surfaces (excludes `current`), for cross-app nav.
 * Local → relative route path; production → absolute `lmthing.<app>` origin
 * (see {@link crossAppOrigin}).
 */
export function otherAppLinks(current: LmthingApp): AppLink[] {
  return (Object.keys(APP_META) as LmthingApp[])
    .filter((app) => app !== current)
    .map((app) => ({ app, ...APP_META[app], url: `${crossAppOrigin(app)}${appRoute(app)}` }))
}

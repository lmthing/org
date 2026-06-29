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

/** Links to the *other* unified surfaces (excludes `current`), for cross-app nav. */
export function otherAppLinks(current: LmthingApp): AppLink[] {
  return (Object.keys(APP_META) as LmthingApp[])
    .filter((app) => app !== current)
    .map((app) => ({ app, ...APP_META[app], url: appRoute(app) }))
}

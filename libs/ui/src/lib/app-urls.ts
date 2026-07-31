import { isWeb } from '@lmthing/auth'
import { apiBase, cloudBaseOverride } from '../platform/api-base'

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
export type LmthingApp = 'studio' | 'chat' | 'computer' | 'team'

interface ViteEnv {
  DEV?: boolean
  VITE_STUDIO_URL?: string
  VITE_CHAT_URL?: string
  VITE_COMPUTER_URL?: string
  VITE_TEAM_URL?: string
  VITE_COMPUTER_BASE_URL?: string
  VITE_CLOUD_BASE_URL?: string
  VITE_CLOUD_URL?: string
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
  team: 'VITE_TEAM_URL',
}

/** Absolute origin for one of the lmthing apps (explicit env override only). */
export function appUrl(app: LmthingApp): string {
  const env = readEnv()
  const override = env[ENV_KEY[app]] as string | undefined
  if (override) return override
  const protocol = isWeb() ? window.location.protocol : 'https:'
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
  if (!isWeb()) return ''
  if (window.location.hostname.startsWith('lmthing.')) return `https://lmthing.${app}`
  return ''
}

/** Data-plane services the served UI talks to: the compute pod and the gateway. */
export type ApiRole = 'computer' | 'cloud'

/**
 * Origin for a data-plane API (compute pod or cloud gateway), resolved the same
 * way the web app's own `lib/config`/`lib/origins` do so the shared UI (e.g. the
 * settings dialog) can reach them without importing app-level config:
 *  - **Production** — the pod is same-origin (Envoy proxies `/api/*`); the
 *    gateway is the canonical `https://lmthing.cloud`.
 *  - **`*.test` nginx dev proxy** — per-service vhost (`computer.test` /
 *    `cloud.test`).
 *  - **`pnpm thing` single-port serve** (localhost) — everything same-origin.
 *
 * An explicit `VITE_{COMPUTER,CLOUD}_BASE_URL` (or `VITE_CLOUD_URL`) override
 * always wins, matching `apps/web/src/lib/config.ts`.
 */
export function dataPlaneOrigin(role: ApiRole): string {
  const env = readEnv()
  const override =
    role === 'cloud'
      ? (env.VITE_CLOUD_BASE_URL ?? env.VITE_CLOUD_URL)
      : env.VITE_COMPUTER_BASE_URL
  if (override) return override.replace(/\/$/, '')

  // Neither native nor the desktop shell has a `window.location` worth deriving an answer from —
  // native has none at all, and a Tauri renderer's is `tauri://localhost`. Both hosts state their
  // two origins instead, so ask them before falling through to the location-derived answers below.
  //
  // The `computer` arm matters as much as the `cloud` one and used to be missing: without it this
  // returned `window.location.origin` for a pod, which on native was `''` and on desktop was the
  // `tauri://` scheme — a value that reaches `fetch` and fails as a network error rather than as a
  // configuration one.
  const hostOrigin = role === 'cloud' ? cloudBaseOverride() : apiBase()
  if (hostOrigin) return hostOrigin

  const hostname = isWeb() ? window.location.hostname : ''
  const origin = isWeb() ? window.location.origin : ''
  if (!env.DEV) return role === 'cloud' ? 'https://lmthing.cloud' : origin
  if (hostname.endsWith('.test')) {
    return role === 'cloud' ? 'https://cloud.test' : 'https://computer.test'
  }
  return origin
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
  team: { label: 'Team', emoji: '👥' },
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

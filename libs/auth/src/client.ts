import type { AuthConfig, AuthSession } from './types'
import { isWeb, isDesktopRun } from './env'
import { readItem, writeItem, removeItem, hydrate, isHydrated } from './platform/session-store'
import { getRandomValues } from './platform/crypto'
import { startLogin, completeRedirect } from './platform/sso'
import { stateFromBytes } from './sso-exchange'

/** Re-exported so `isWeb` keeps its long-standing import path; the implementation lives in
 *  `./env` beside `isDesktopRun`, which needs the same DOM check and must not import this file
 *  back (a cycle). */
export { isWeb }

const SESSION_KEY = 'lmthing_session'
const PIN_HASH_KEY = 'lmthing_pin_hash'
const PIN_SET_KEY = 'lmthing_pin_set'

/** Refresh this many seconds before the access token actually expires. */
const REFRESH_BUFFER = 60

// Pub/sub so React state stays in sync when a token is rotated out-of-band
// (e.g. by authFetch's 401-retry, which writes to the session store directly).
const sessionListeners = new Set<(session: AuthSession | null) => void>()

/** Everything `readItem` must be able to answer for synchronously. */
const HYDRATED_KEYS = [SESSION_KEY, PIN_HASH_KEY, PIN_SET_KEY] as const

/**
 * Load persisted auth state into the synchronous store.
 *
 * A no-op on web, where `localStorage` is already synchronous. On native it reads the OS keystore,
 * which is async — so **this must be awaited before anything that reads a session renders**, or the
 * app paints a logged-out shell and then flips. Listeners are notified afterwards, so a provider
 * that subscribed early converges either way.
 */
export async function hydrateAuth(): Promise<void> {
  await hydrate(HYDRATED_KEYS)
  emitSessionChange(getSession())
}

/** Whether {@link hydrateAuth} has completed. Always true on web. */
export function isAuthHydrated(): boolean {
  return isHydrated()
}

export function onSessionChange(cb: (session: AuthSession | null) => void): () => void {
  sessionListeners.add(cb)
  return () => sessionListeners.delete(cb)
}

function emitSessionChange(session: AuthSession | null): void {
  sessionListeners.forEach(cb => cb(session))
}

function generateState(): string {
  return stateFromBytes(getRandomValues(new Uint8Array(16)))
}

/**
 * Begin an interactive login.
 *
 * Stays `void`-returning, which is what `AuthProvider`'s `login: () => void` needs and what web
 * always did (the page unloads). On native the flow completes IN this call, so the result is stored
 * here and subscribers hear about it through {@link onSessionChange} — the same channel that already
 * carries an out-of-band token rotation. No caller had to change.
 */
export function redirectToLogin(config: AuthConfig): void {
  void startLogin(config, generateState())
    .then(session => {
      if (session) storeSession(session)
    })
    .catch(err => {
      console.error('login failed:', err)
    })
}

/**
 * Finish a login that a redirect handed back to the app (web). Native resolves null — its
 * {@link redirectToLogin} already stored the session.
 *
 * Returning the CURRENT session when nothing was consumed preserves the previous behaviour for the
 * case that actually occurs: React StrictMode double-invokes the effect in dev, so the second run
 * finds the state already cleared and must not be read as "logged out".
 */
export async function handleAuthCallback(config: AuthConfig): Promise<AuthSession | null> {
  const session = await completeRedirect(config)
  if (!session) return getSession()
  storeSession(session)
  return session
}

export async function refreshSession(config: AuthConfig): Promise<AuthSession | null> {
  const current = getSession()
  if (!current?.refreshToken) return null

  const res = await fetch(`${config.cloudUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: current.refreshToken }),
  })

  if (!res.ok) return null

  const data = await res.json()
  const session: AuthSession = {
    ...current,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt: data.expires_at ?? undefined,
  }

  writeItem(SESSION_KEY, JSON.stringify(session))
  emitSessionChange(session)
  return session
}

/** True when the access token is within REFRESH_BUFFER of expiry (or past it). */
export function isSessionExpired(session: AuthSession | null, bufferSec = REFRESH_BUFFER): boolean {
  if (!session?.expiresAt) return false
  return Math.floor(Date.now() / 1000) >= session.expiresAt - bufferSec
}

/**
 * Return a live access token, refreshing first if the current one is near
 * expiry. Clears the session and throws if there is no refresh token or the
 * refresh fails — callers should treat the throw as "force re-login".
 */
export async function ensureValidToken(config: AuthConfig): Promise<string> {
  const current = getSession()
  if (!current) throw new Error('Not authenticated')

  if (!isSessionExpired(current)) return current.accessToken
  if (!current.refreshToken) {
    clearSession()
    throw new Error('Session expired')
  }

  const refreshed = await refreshSession(config)
  if (!refreshed) {
    clearSession()
    throw new Error('Session expired')
  }
  return refreshed.accessToken
}

/**
 * Authenticated fetch with automatic token rotation.
 *
 * Sets `Authorization: Bearer <token>` from the stored session, refreshing it
 * first if it is near expiry. On a 401 response it force-refreshes once and
 * retries — this is what keeps long-lived tabs working after the 12h access
 * token expires. Returns the raw Response; callers check `res.ok` like fetch.
 */
/**
 * True when `res` is the Envoy activator's "waking" 503: the target pod was
 * scaled to zero, so Envoy had no endpoint and returned a JSON `{waking:true}`
 * body after firing a wake. A no-endpoint 503 means the request never reached
 * the pod (zero side effects), so retrying it — even a POST — is always safe.
 */
async function isWakingResponse(res: Response): Promise<boolean> {
  if (res.status !== 503) return false
  try {
    const data = (await res.clone().json()) as { waking?: boolean }
    return data?.waking === true
  } catch {
    return false
  }
}

const WAKE_RETRIES = 6
const WAKE_RETRY_MS = 1200

export async function authFetch(
  config: AuthConfig,
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await ensureValidToken(config)
  const headers = new Headers(options.headers)
  headers.set('authorization', `Bearer ${token}`)

  let res = await fetch(url, { ...options, headers })

  if (res.status === 401) {
    const refreshed = await refreshSession(config)
    if (refreshed) {
      headers.set('authorization', `Bearer ${refreshed.accessToken}`)
      res = await fetch(url, { ...options, headers })
    } else {
      clearSession()
    }
  }

  // The pod was scaled to zero: the Envoy activator returned a "waking" 503 and
  // fired a wake. Transparently retry so the request self-heals into the freshly
  // woken pod instead of surfacing a one-off failure to the user.
  for (let i = 0; i < WAKE_RETRIES && (await isWakingResponse(res)); i++) {
    await new Promise((r) => setTimeout(r, WAKE_RETRY_MS))
    res = await fetch(url, { ...options, headers })
  }

  return res
}

export function getAuthHeaders(): Record<string, string> {
  const raw = readItem(SESSION_KEY)
  if (!raw) return {}

  try {
    const session: AuthSession = JSON.parse(raw)
    return { Authorization: `Bearer ${session.accessToken}` }
  } catch {
    return {}
  }
}

export function getSession(): AuthSession | null {
  const raw = readItem(SESSION_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Token injected by the pod bootstrap (window.__LM_ACCESS_TOKEN__), or null. */
export function getPodInjectedToken(): string | null {
  if (!isWeb()) return null
  const t = (window as unknown as { __LM_ACCESS_TOKEN__?: string }).__LM_ACCESS_TOKEN__
  return t && t.length > 0 ? t : null
}

/** True when this app is being served embedded by the user's compute pod. */
export function isPodEmbedded(): boolean {
  return getPodInjectedToken() !== null
}

/**
 * True when running locally — the pod served on localhost/loopback, or the
 * `*.test` dev proxy. In this mode the app skips the auth wall and the
 * pod-ensure gate: the local pod doesn't enforce auth and is already the
 * server serving this app. Production hostnames (lmthing.*) return false, so
 * real gateway auth is unaffected.
 *
 * The desktop shell is excluded FIRST and unconditionally. A Tauri webview serves the app from
 * `tauri://localhost` on macOS/Linux — hostname `localhost` — so without this branch the hostname
 * test below fires, `AuthProvider` sets `isDemo`, and the app boots straight into `DEMO_SESSION`
 * with `accessToken: 'demo'`: the login screen never appears and every pod call 401s. Windows
 * serves from `http://tauri.localhost` and does not match, so the bug was OS-divergent and silent.
 *
 * The test is `isDesktopRun()` — the explicit injected global — and NOT a `tauri:` scheme sniff,
 * because in local mode the shell points the same webview at a real loopback sidecar. Keying on
 * the scheme would put that back into demo mode; keying on the global says what is actually
 * being asked: "is a host telling us where the pod is?"
 */
export function isLocalRun(): boolean {
  if (isDesktopRun()) return false
  if (!isWeb()) return false
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.test')
}

export function clearSession(): void {
  removeItem(SESSION_KEY)
  emitSessionChange(null)
}

export function storeSession(session: AuthSession): void {
  writeItem(SESSION_KEY, JSON.stringify(session))
  emitSessionChange(session)
}

// PIN utilities for client-side encryption

export function isPinSet(): boolean {
  return readItem(PIN_SET_KEY) === 'true'
}

export function getPinHash(): string | null {
  return readItem(PIN_HASH_KEY)
}

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(pin)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPin(pin: string): Promise<boolean> {
  const storedHash = getPinHash()
  if (!storedHash) return false
  const inputHash = await hashPin(pin)
  return inputHash === storedHash
}

/**
 * Derive a CryptoKey from the PIN for encrypting/decrypting sensitive data.
 * Uses PBKDF2 with a fixed salt derived from the user ID.
 */
export async function derivePinKey(pin: string, userId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`lmthing_${userId}`),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { AuthSession, AuthConfig, AuthContextValue } from './types'
import { getSession, clearSession, storeSession, redirectToLogin, handleAuthCallback, refreshSession, ensureValidToken, authFetch, isSessionExpired, onSessionChange, isPinSet, verifyPin, derivePinKey, getPodInjectedToken, isLocalRun, isWeb } from './client'

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * `import.meta.env` read through ONE local accessor rather than directly.
 *
 * This package ships SOURCE (`main: "./src/index.ts"`, no build step), so every consumer typechecks
 * these files inside its OWN program — where `src/vite-env.d.ts` is not loaded and `vite/client` is
 * not in `types`. Reading `import.meta.env` directly therefore handed 4 phantom
 * "Property 'env' does not exist on type 'ImportMeta'" errors to each consumer, which is exactly
 * how they reached `libs/ui`. Declaring the ambient `ImportMeta` here instead would collide with
 * `vite/client` inside this package's own program (`env` optional vs required), so the shape is
 * asserted at the single point of use. The `typeof` guard is retained: this runs under Node in
 * tests and SSR, where `import.meta.env` is absent.
 */
const viteEnv = (): Record<string, string | boolean | undefined> =>
  typeof import.meta === 'undefined'
    ? {}
    : (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env ?? {}

function resolveConfig(appName: string, callbackPath: string): AuthConfig {
  const env = viteEnv()
  const isDev = Boolean(env.DEV)
  const protocol = isWeb() ? window.location.protocol : 'https:'

  return {
    comUrl: (env.VITE_COM_URL as string | undefined)
      || (isDev ? `${protocol}//com.test` : 'https://lmthing.com'),
    cloudUrl: (env.VITE_CLOUD_URL as string | undefined)
      || (isDev ? `${protocol}//cloud.test` : 'https://lmthing.cloud'),
    appName,
    callbackPath,
  }
}

interface AuthProviderProps {
  appName: string
  callbackPath?: string
  children: React.ReactNode
}

const DEMO_SESSION: AuthSession = {
  accessToken: 'demo',
  userId: 'demo-user',
  email: 'demo@lmthing.local',
  githubRepo: null,
  githubUsername: null,
}

export function AuthProvider({ appName, callbackPath = '/', children }: AuthProviderProps) {
  const config = useMemo(() => resolveConfig(appName, callbackPath), [appName, callbackPath])
  // Demo/local mode skips login + pin. VITE_DEMO_USER (build-time) or a local
  // run (localhost / *.test — the pod serves the app itself, no gateway auth).
  const isDemo = viteEnv().VITE_DEMO_USER === 'true' || isLocalRun()
  const [session, setSession] = useState<AuthSession | null>(isDemo ? DEMO_SESSION : null)
  const [isLoading, setIsLoading] = useState(!isDemo)
  const [pinUnlocked, setPinUnlocked] = useState(false)
  const pinKeyRef = useRef<CryptoKey | null>(null)

  // Accept session injected by a parent frame (e.g. lmthing.chat → lmthing.computer iframe).
  // Iframes are a web-only concept — there is no `window` on native.
  useEffect(() => {
    if (isDemo || !isWeb()) return
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'lmthing:session' && e.data.session) {
        storeSession(e.data.session)
        setSession(e.data.session)
        setIsLoading(false)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [isDemo])

  useEffect(() => {
    if (isDemo) return
    const injected = getPodInjectedToken()
    if (injected) {
      const podSession: AuthSession = {
        accessToken: injected,
        userId: 'pod-user',
        email: '',
        githubRepo: null,
        githubUsername: null,
      }
      storeSession(podSession)
      setSession(podSession)
      setIsLoading(false)
      return
    }
    // A `?code=` in the URL only ever happens on a web redirect callback — on native,
    // `redirectToLogin` already resolved the session in-process (see platform/sso.native.ts),
    // so there is nothing in the URL to consume.
    const url = isWeb() ? new URL(window.location.href) : null
    if (url?.searchParams.has('code')) {
      handleAuthCallback(config)
        .then(sess => {
          if (sess) setSession(sess)
        })
        .catch(console.error)
        .finally(() => {
          url.searchParams.delete('code')
          url.searchParams.delete('state')
          window.history.replaceState({}, '', url.pathname)
          setIsLoading(false)
        })
    } else {
      // Cold reload: if the access token is already expired but we still have a
      // refresh token, rotate it BEFORE unblocking the UI. Otherwise the app's
      // first requests fly out with a stale token and 401 before the proactive
      // timer runs — the exact "stuck on 401" state we're fixing.
      const existing = getSession()
      if (existing && isSessionExpired(existing) && existing.refreshToken) {
        refreshSession(config)
          .then(refreshed => {
            if (refreshed) {
              setSession(refreshed)
            } else {
              clearSession()
              setSession(null)
            }
          })
          .catch(() => {
            clearSession()
            setSession(null)
          })
          .finally(() => setIsLoading(false))
      } else {
        setSession(existing)
        setIsLoading(false)
      }
    }
  }, [config, isDemo])

  // Stay in sync with token rotations that happen out-of-band (e.g. inside
  // authFetch's 401-retry, which writes directly to localStorage). Without this
  // the `session` state held by React — and the sync `session.accessToken`
  // getter passed to some runtimes — would go stale until next reload.
  useEffect(() => {
    if (isDemo) return
    return onSessionChange(sess => setSession(sess))
  }, [isDemo])

  // Proactively refresh the access token 5 minutes before expiry.
  // If already expired on load, refresh immediately.
  useEffect(() => {
    if (isDemo || !session?.refreshToken || !session.expiresAt) return

    const REFRESH_BUFFER = 5 * 60 // seconds
    const now = Math.floor(Date.now() / 1000)
    const delay = Math.max(0, session.expiresAt - now - REFRESH_BUFFER) * 1000

    const timer = setTimeout(async () => {
      const refreshed = await refreshSession(config)
      if (refreshed) {
        setSession(refreshed)
      } else {
        // Refresh token is also expired — force re-login
        clearSession()
        setSession(null)
      }
    }, delay)

    return () => clearTimeout(timer)
  }, [isDemo, session?.refreshToken, session?.expiresAt, config])

  const login = useCallback(() => {
    if (isDemo) return
    // Iframe embedding is a web-only concept — native always calls redirectToLogin directly.
    if (isWeb() && window !== window.top) {
      // Embedded as iframe — ask parent to provide the session instead of navigating
      window.parent.postMessage({ type: 'lmthing:auth-needed' }, '*')
      return
    }
    redirectToLogin(config)
  }, [config, isDemo])

  const logout = useCallback(() => {
    if (isDemo) return
    clearSession()
    setSession(null)
    setPinUnlocked(false)
    pinKeyRef.current = null
  }, [isDemo])

  const unlockPin = useCallback(async (pin: string): Promise<boolean> => {
    const valid = await verifyPin(pin)
    if (valid && session) {
      pinKeyRef.current = await derivePinKey(pin, session.userId)
      setPinUnlocked(true)
    }
    return valid
  }, [session])

  const getPinKey = useCallback(async (): Promise<CryptoKey | null> => {
    return pinKeyRef.current
  }, [])

  const getAccessToken = useCallback(() => ensureValidToken(config), [config])

  const authFetchBound = useCallback(
    (url: string, options?: RequestInit) => authFetch(config, url, options),
    [config],
  )

  // Live sync read of the stored token (no refresh). Paired with `refreshAuth`
  // for injection into runtimes (e.g. PodTransport) that need a getter which
  // returns the fresh token after a forced refresh — a React closure captured
  // at mount would go stale, but reading localStorage always sees the latest.
  const getAccessTokenSync = useCallback(() => getSession()?.accessToken ?? null, [])

  const refreshAuth = useCallback(async () => {
    await refreshSession(config)
  }, [config])

  const username = session?.email ?? null
  const isAuthenticated = !!session
  const needsPin = !isDemo && isPinSet() && !pinUnlocked
  const githubRepo = session?.githubRepo ?? null
  const githubUsername = session?.githubUsername ?? null

  return (
    <AuthContext.Provider value={{
      session,
      username,
      isAuthenticated,
      isLoading,
      githubRepo,
      githubUsername,
      needsPin,
      pinUnlocked,
      login,
      logout,
      getAccessToken,
      getAccessTokenSync,
      refreshAuth,
      authFetch: authFetchBound,
      unlockPin,
      getPinKey,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

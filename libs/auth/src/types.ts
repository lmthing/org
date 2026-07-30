import type { EmailCodeSent } from './email-login'

export interface AuthSession {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  userId: string
  email: string
  githubRepo: string | null
  githubUsername: string | null
}

export interface AuthConfig {
  comUrl: string
  cloudUrl: string
  appName: string
  callbackPath: string
}

export interface AuthContextValue {
  session: AuthSession | null
  username: string | null
  isAuthenticated: boolean
  isLoading: boolean
  githubRepo: string | null
  githubUsername: string | null
  needsPin: boolean
  pinUnlocked: boolean
  /** GitHub / SSO sign-in. Leaves the app: a redirect on web, a browser session on native. */
  login: () => void
  /**
   * Mail a one-time code to any address. Resolves once the gateway has sent it.
   *
   * Pairs with {@link signInWithEmailCode} to sign in **without leaving the app** — the reason
   * native does not need a browser sheet for this path. Throws with the gateway's own message
   * (unsendable address, per-mailbox throttle, or a deployment with no mail transport).
   */
  sendEmailCode: (email: string) => Promise<EmailCodeSent>
  /** Exchange a mailed code for a session and adopt it as the app's session. */
  signInWithEmailCode: (email: string, code: string) => Promise<void>
  logout: () => void
  /** Returns a live access token, refreshing first if near expiry. */
  getAccessToken: () => Promise<string>
  /** Sync read of the current access token from the session store (no refresh).
   *  Use for inject-into-runtimes getters that must always return the latest
   *  stored token, paired with `refreshAuth` for the 401-retry path. */
  getAccessTokenSync: () => string | null
  /** Force-rotates the token pair now (used as the transport's `refresh`). */
  refreshAuth: () => Promise<void>
  /** Authenticated fetch with automatic refresh + 401 retry. */
  authFetch: (url: string, options?: RequestInit) => Promise<Response>
  unlockPin: (pin: string) => Promise<boolean>
  getPinKey: () => Promise<CryptoKey | null>
  /**
   * Origin of the account surface (`lmthing.com`), already resolved for this
   * environment. Exposed because a shared surface has no other way to link to the
   * account pages the store policies require — privacy and account deletion — and
   * `crossAppOrigin` cannot answer for `com`: it knows only the four product
   * surfaces, and returns `''` off the web, which on a phone is not a URL at all.
   */
  comUrl: string
}

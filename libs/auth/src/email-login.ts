import type { AuthConfig, AuthSession } from './types'

/**
 * Passwordless email sign-in — the whole flow, for every target.
 *
 * This is the one login path that needs no browser hop at all: two plain `fetch` calls straight to
 * the gateway, so a React Native app can sign a user in **inside the app**, with no
 * `WebBrowser.openAuthSessionAsync` sheet and no SSO code round-trip through `com`. That is the
 * reason it lives here rather than behind the `platform/sso` fork — there is nothing to fork. The
 * same two functions serve web, where they sit alongside the redirect flow rather than replacing it.
 *
 * GitHub sign-in still goes through `platform/sso`, and must: an OAuth handoff to an external
 * identity provider has to happen in a real browser session (ASWebAuthenticationSession / Custom
 * Tab). Embedding it in a WebView breaks GitHub's own policy and is an app-store rejection risk.
 *
 * Storage is deliberately NOT done here, matching {@link exchangeSsoCode}: the caller decides when a
 * session becomes the app's session, and these stay reasonable (and testable) as pure exchanges.
 */

/** What the gateway confirms after mailing a code — never the code itself. */
export interface EmailCodeSent {
  /** Masked, e.g. `v••••@gmail.com`. The gateway does not echo the address back in full. */
  maskedEmail: string
  /** Unix seconds at which the code stops working. */
  expiresAt: number
  /**
   * Present ONLY on a dev deployment with no mail transport configured, so a local run can finish
   * the flow with no relay. The gateway suppresses both the moment a real transport exists, so
   * neither can leak in production.
   */
  devCode?: string
  devLink?: string
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null)
  const message = body?.error?.message ?? body?.error ?? fallback
  return new Error(typeof message === 'string' ? message : fallback)
}

/**
 * Ask the gateway to mail a 6-digit code (and a magic link) to `email`.
 *
 * `redirectUri` is where the magic link lands when clicked, and is **web-only**: the gateway
 * validates it against an origin allowlist that accepts `http`/`https` and nothing else, so a
 * native deep link like `lmthing://auth/callback` is rejected outright. Native therefore omits it
 * and the user types the code instead — which is the path that works regardless of which device the
 * mail is read on.
 */
export async function requestEmailCode(
  config: AuthConfig,
  email: string,
  redirectUri?: string,
): Promise<EmailCodeSent> {
  const res = await fetch(`${config.cloudUrl}/api/auth/email/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The gateway answers with a cookie naming this browser, and the magic-link
    // callback completes a login only for the browser that asked. Without this the
    // cookie is dropped (cross-site) and a link clicked in this very browser would
    // be treated as a different device. Inert on native, which has no magic link.
    credentials: 'include',
    body: JSON.stringify({ email, ...(redirectUri ? { redirect_uri: redirectUri } : {}) }),
  })

  if (!res.ok) throw await errorFrom(res, 'Could not send the sign-in code')

  const data = await res.json()
  return {
    maskedEmail: data.email,
    expiresAt: data.expires_at,
    devCode: data.dev_code ?? undefined,
    devLink: data.dev_link ?? undefined,
  }
}

/**
 * Trade the mailed code for a session.
 *
 * The mapping is deliberately identical to {@link exchangeSsoCode}'s, because both produce the same
 * gateway JWT pair for the same Zitadel user — an email sign-in and a GitHub sign-in for one address
 * resolve to ONE account, so the session they yield must not differ in shape.
 */
export async function verifyEmailCode(
  config: AuthConfig,
  email: string,
  code: string,
): Promise<AuthSession> {
  const res = await fetch(`${config.cloudUrl}/api/auth/email/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })

  if (!res.ok) throw await errorFrom(res, 'That code did not work')

  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? undefined,
    expiresAt: data.expires_at ?? undefined,
    userId: data.user.id,
    email: data.user.email,
    githubRepo: data.user.github_repo ?? null,
    githubUsername: data.user.github_username ?? null,
  }
}

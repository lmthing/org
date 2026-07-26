import type { AuthConfig, AuthSession } from './types'

/**
 * The half of SSO login that is the same everywhere: trade a single-use code for a session.
 *
 * Login differs between targets only in **how the user is sent to the identity provider and how the
 * code comes back** — a full-page redirect on web, an in-app browser session on native. Everything
 * after that is one HTTP call and one object mapping, so it lives here rather than being written
 * twice in the two `platform/sso` forks. A duplicated VALUE is the thing the fork ratchet exists to
 * prevent, and a session mapping that drifted between targets would be exactly that.
 *
 * Storage is deliberately NOT done here. The caller stores, so there is one place that decides when
 * a session becomes the app's session — and so this function can be reasoned about (and tested) as
 * a pure exchange.
 */
export async function exchangeSsoCode(
  config: AuthConfig,
  code: string,
  redirectUri: string,
): Promise<AuthSession> {
  const res = await fetch(`${config.cloudUrl}/api/auth/sso/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The gateway stores `redirect_uri` verbatim with the code and requires an EXACT match on
    // consume (`findAndConsumeSsoCode`, no allowlist), so this must be the same string that was
    // sent to `/auth/sso` — including a custom scheme like `lmthing://auth/callback`.
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: 'SSO exchange failed' } }))
    throw new Error(body.error?.message || 'SSO exchange failed')
  }

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

/** Hex-encode random bytes as an OAuth `state` value. */
export function stateFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

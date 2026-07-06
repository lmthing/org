/**
 * Platform-session cookie for lmthing.app's pod routes.
 *
 * A project-app is single-user and has no auth of its own — the only auth is the platform
 * deciding *which pod* a request routes to. The gateway does that from the per-user JWT, which
 * SPA fetches carry as an `Authorization: Bearer` header. But an app **page navigation** and its
 * relative `<script>/<link>` **asset** requests can't carry a header, so we mirror the same JWT
 * into a scoped `access_token` **cookie**; the gateway's `app-jwt` SecurityPolicy reads it and
 * routes every `/app/*` request (page + assets + the app's own api) to this user's pod.
 *
 * Scope + exposure: `path=/` — in production apps are served at the ROOT mount
 * (`lmthing.app/<project>/…`, Envoy catch-all → pod), so the cookie must cover the whole
 * origin, not just `/app`; it rides only same-origin lmthing.app requests. It is not HttpOnly
 * (it is the same JS-visible token already held in memory by `@lmthing/auth`) and is only set
 * over https (`secure`). No-op with an empty token, and harmless in local dev (no gateway reads it).
 */
export function setPodSessionCookie(token: string | null | undefined): void {
  if (!token || typeof document === 'undefined') return
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `access_token=${encodeURIComponent(token)}; path=/; samesite=strict${secure}`
}

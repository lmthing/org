/**
 * The two absolute hosts this app talks to, in one place.
 *
 * A React Native bundle has no origin, so every control-plane call has to name its host — and
 * three files had independently written `'https://lmthing.cloud'` as a literal, which meant
 * pointing the app anywhere else was three edits that had to agree.
 *
 * Both are overridable through `EXPO_PUBLIC_*`, which `babel-preset-expo` inlines at build time.
 * That is the same seam `apiBase()` already uses for the pod
 * (`sdk/org/libs/ui/src/platform/api-base.native.ts`), and it exists for the same reason: a device
 * build cannot be pointed at a local rig by editing a config file it does not read, so without it
 * the team surface can only be exercised against production.
 *
 * Both default to production, so a build that sets nothing behaves exactly as before.
 */

/** Strip a trailing slash so callers can always write `${base}/api/...`. */
function host(configured: string | undefined, fallback: string): string {
  return configured ? configured.replace(/\/+$/, '') : fallback
}

/** The gateway: auth, `/api/teams/*` (plural), `/api/compute/*`, `/api/push/*`. */
export const CLOUD_BASE_URL = host(process.env.EXPO_PUBLIC_CLOUD_BASE, 'https://lmthing.cloud')

/**
 * Where a PERSONAL project's app is reached — **`lmthing.app`, NOT the chat host**.
 *
 * This is the host whose edge has an `/app/*` HTTPRoute into the per-user pod
 * (`devops/argocd/envoy/app-routes.yaml#app-pages-proxy`), authenticated by the Bearer token the
 * same JWT policy reads for a fetch (`devops/argocd/envoy/app-policies.yaml`). The chat host
 * (`apiBase()` = `lmthing.chat`) routes ONLY `/api/*` to the pod; a `/app/<project>/api/*` call
 * there falls through to the static chat SPA and comes back as HTML, which the view client reports
 * as "request failed" (a write) or an empty list (a read). That is exactly the bug this fixes:
 * the app's data calls were going to a host that does not serve the app.
 *
 * `/api/*` is bound to the same per-user backend on `lmthing.app` too
 * (`app-routes.yaml#app-api-proxy`), so the one-round-trip `GET /api/apps/:id/views` probe rides
 * this base as well — the whole app-open flow speaks to one host, and it is the host that answers
 * for `/app/*`. Overridable with `EXPO_PUBLIC_APP_BASE`, read at call time exactly like `apiBase()`.
 */
export function appBase(): string {
  return host(process.env.EXPO_PUBLIC_APP_BASE, 'https://lmthing.app')
}

// `TEAM_BASE_URL` used to live here too. It moved into the platform seam as
// `@lmthing/ui/platform#teamBase`, because the team control-plane helpers that read it are now
// shared code (`@lmthing/ui/team`) serving three hosts. Keeping a copy here would have meant two
// readers of one `EXPO_PUBLIC_TEAM_BASE` that could drift — which is the exact failure this file's
// header was written to prevent.

/**
 * The served URL of a PERSONAL project's app page — the WebView path's `src`.
 *
 * On `{@link appBase}` (`lmthing.app`), under the reserved `/app/` prefix that the edge routes
 * into the pod. This used to read `apiBase()` (`lmthing.chat`), which has no `/app` route — so the
 * WebView loaded the chat SPA instead of the app.
 *
 * `routePath` (a served pattern like `/` or `/settings/profile`) deep-links a specific page. It is
 * only meaningful on the WebView path — a legacy `appbuilder` app the native renderer cannot draw —
 * where the reader tapped a specific page in the sidebar and would otherwise land on the index.
 */
export function appUrl(projectId: string, routePath = '/'): string {
  return `${appBase()}/app/${projectId}/${routePath.replace(/^\//, '')}`
}

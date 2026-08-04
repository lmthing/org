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

import { apiBase } from '@lmthing/ui/platform'

/** Strip a trailing slash so callers can always write `${base}/api/...`. */
function host(configured: string | undefined, fallback: string): string {
  return configured ? configured.replace(/\/+$/, '') : fallback
}

/** The gateway: auth, `/api/teams/*` (plural), `/api/compute/*`, `/api/push/*`. */
export const CLOUD_BASE_URL = host(process.env.EXPO_PUBLIC_CLOUD_BASE, 'https://lmthing.cloud')

// `TEAM_BASE_URL` used to live here too. It moved into the platform seam as
// `@lmthing/ui/platform#teamBase`, because the team control-plane helpers that read it are now
// shared code (`@lmthing/ui/team`) serving three hosts. Keeping a copy here would have meant two
// readers of one `EXPO_PUBLIC_TEAM_BASE` that could drift — which is the exact failure this file's
// header was written to prevent.

/**
 * Where a PERSONAL project's app pages are served.
 *
 * The same reserved `/app/` prefix the team pod uses — the difference is only which pod answers,
 * and that is the whole reason the two bases are separate constants rather than one. `apiBase()`
 * rather than a fourth literal, because the personal pod is the pod this app already talks to.
 *
 * `routePath` (a served pattern like `/` or `/settings/profile`) deep-links a specific page. It is
 * only meaningful on the WebView path — a legacy `appbuilder` app the native renderer cannot draw —
 * where the reader tapped a specific page in the sidebar and would otherwise land on the index.
 */
export function appUrl(projectId: string, routePath = '/'): string {
  return `${apiBase()}/app/${projectId}/${routePath.replace(/^\//, '')}`
}

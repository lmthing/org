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

/**
 * Where a TEAM's pod is reached. The edge routes by the team claim in the token, so the host is the
 * team surface's own domain and the pod is whichever one that token names — there is no per-team
 * hostname to construct.
 */
export const TEAM_BASE_URL = host(process.env.EXPO_PUBLIC_TEAM_BASE, 'https://lmthing.team')

/**
 * Where a PERSONAL project's app pages are served.
 *
 * The same reserved `/app/` prefix the team pod uses — the difference is only which pod answers,
 * and that is the whole reason the two bases are separate constants rather than one. `apiBase()`
 * rather than a fourth literal, because the personal pod is the pod this app already talks to.
 */
export function appUrl(projectId: string): string {
  return `${apiBase()}/app/${projectId}/`
}

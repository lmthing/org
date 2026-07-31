/**
 * Where a tapped push notification should land — the pure half of `push.ts`.
 *
 * Split out on purpose: `push.ts` imports `react-native` at module scope (for
 * `Platform.OS`), and Vite/Rollup cannot parse the Flow syntax real React Native ships
 * outside Metro's own babel transform — importing it at all makes a file untestable under
 * plain `vitest`. This module imports nothing, so `parseTeamDeepLink`'s decision table is
 * testable without Metro, the same reasoning `./app-views.ts` states for itself.
 */

/** Where a tapped push notification should land: a team, and optionally a channel in it. */
export interface PushDeepLink {
  teamId: string
  channelId?: string
}

/**
 * Pull the team (and, if named, the channel) out of a push notification's `url`.
 *
 * The gateway's payload always carries a `data.url` shaped for a BROWSER — the same path
 * `lmthing.team` itself would navigate to (`team-push.ts#pushPayload`:
 * `/team/<teamId>/channels?channel=<channelId>`). There is no router here to hand that to,
 * so this is the native-side twin of what a web `<Link>` would have resolved for free.
 *
 * Deliberately NOT the WHATWG `URL` global: this repo avoids it on native (see
 * `libs/auth/src/AuthProvider.tsx`, gated behind `isWeb()`) because Hermes ships without an
 * implementation and nothing here pulls in a polyfill — a plain split is enough for a path
 * this simple, and it is what `resolveRoute` in `./app-views.ts` already does for the same
 * reason.
 */
export function parseTeamDeepLink(url: string): PushDeepLink | null {
  const [path, query] = url.split('?')
  const segments = (path ?? '').split('/').filter(Boolean)
  if (segments[0] !== 'team' || !segments[1]) return null
  const teamId = decodeURIComponent(segments[1])
  const channelParam = query
    ?.split('&')
    .map((pair) => pair.split('='))
    .find(([key]) => key === 'channel')?.[1]
  return { teamId, ...(channelParam ? { channelId: decodeURIComponent(channelParam) } : {}) }
}

/**
 * Suppresses handling the SAME delivered notification twice, without ever suppressing a genuinely
 * different one — `watchPushDeepLinks` (`./push.ts`) wires both a live listener and a one-shot
 * `getLastNotificationResponseAsync` cold-start check, and Expo's own docs note the two can BOTH
 * fire for the identical tap in the same launch. Undetected, that reads as two rapid notifications
 * — exactly the case this app must also get right, since the fix for one must not become the bug
 * in the other: this only ever compares the notification's own `request.identifier`, which is
 * stable for one delivered notification and distinct for any other, including two that arrive
 * moments apart.
 *
 * A pure factory (not a class) for the same reason `resolveFocusTeamId` in `./team-focus.ts` is a
 * pure function: the decision is testable without `react-native` or `expo-notifications` in the
 * import graph.
 */
export function createNotificationDeduper(): (requestId: string | null | undefined) => boolean {
  let last: string | null = null
  return (requestId) => {
    // No identifier to compare against — nothing to dedupe, so never suppress.
    if (!requestId) return true
    if (requestId === last) return false
    last = requestId
    return true
  }
}

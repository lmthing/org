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

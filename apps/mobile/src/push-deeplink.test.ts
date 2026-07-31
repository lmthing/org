/**
 * `parseTeamDeepLink` lives in `./push-deeplink` specifically so it can be imported here
 * without pulling in `react-native` (which `push.ts` does, at module scope, for
 * `Platform.OS`) — Vite/Rollup cannot parse real React Native's Flow syntax outside Metro's
 * babel transform, so a test that imported it through `push.ts` would fail before a single
 * assertion ran. Same rationale as `app-views.test.ts`: prove the decision table without a
 * device.
 */
import { describe, it, expect } from 'vitest'

import { parseTeamDeepLink } from './push-deeplink'

describe('parseTeamDeepLink', () => {
  it('reads the team and channel out of the gateway’s deep-link shape', () => {
    expect(parseTeamDeepLink('/team/abc123/channels?channel=general')).toEqual({
      teamId: 'abc123',
      channelId: 'general',
    })
  })

  it('decodes an encoded team or channel id', () => {
    expect(parseTeamDeepLink('/team/a%20b/channels?channel=c%2Fd')).toEqual({
      teamId: 'a b',
      channelId: 'c/d',
    })
  })

  it('is a team-only link when there is no channel query param', () => {
    expect(parseTeamDeepLink('/team/abc123/channels')).toEqual({ teamId: 'abc123' })
    expect(parseTeamDeepLink('/team/abc123')).toEqual({ teamId: 'abc123' })
  })

  it('ignores a query param that is not the channel', () => {
    expect(parseTeamDeepLink('/team/abc123/channels?thread=t1')).toEqual({ teamId: 'abc123' })
  })

  it('is null for a URL that names no team — the generic `/team` fallback, or anything else', () => {
    expect(parseTeamDeepLink('/team')).toBeNull()
    expect(parseTeamDeepLink('/')).toBeNull()
    expect(parseTeamDeepLink('/computer')).toBeNull()
    expect(parseTeamDeepLink('')).toBeNull()
  })
})

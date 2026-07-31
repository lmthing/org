/**
 * `parseTeamDeepLink` lives in `./push-deeplink` specifically so it can be imported here
 * without pulling in `react-native` (which `push.ts` does, at module scope, for
 * `Platform.OS`) — Vite/Rollup cannot parse real React Native's Flow syntax outside Metro's
 * babel transform, so a test that imported it through `push.ts` would fail before a single
 * assertion ran. Same rationale as `app-views.test.ts`: prove the decision table without a
 * device.
 */
import { describe, it, expect } from 'vitest'

import { parseTeamDeepLink, createNotificationDeduper } from './push-deeplink'

describe('parseTeamDeepLink', () => {
  it('is null for a full URL rather than the bare path the gateway actually sends — a malformed or foreign shape does not crash or half-match', () => {
    expect(parseTeamDeepLink('https://lmthing.team/team/abc123/channels?channel=general')).toBeNull()
    expect(parseTeamDeepLink('lmthing://team/abc123')).toBeNull()
  })

  it('takes the first channel when the query string is malformed with a repeated key', () => {
    expect(parseTeamDeepLink('/team/abc123/channels?channel=a&channel=b')).toEqual({
      teamId: 'abc123',
      channelId: 'a',
    })
  })

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

describe('createNotificationDeduper', () => {
  it('lets the first delivery of a notification through', () => {
    const shouldHandle = createNotificationDeduper()
    expect(shouldHandle('n1')).toBe(true)
  })

  it('suppresses the SAME notification id firing twice — the cold-start-plus-listener race', () => {
    const shouldHandle = createNotificationDeduper()
    expect(shouldHandle('n1')).toBe(true)
    expect(shouldHandle('n1')).toBe(false)
    expect(shouldHandle('n1')).toBe(false)
  })

  it('never suppresses a genuinely different notification — two rapid pushes both get through', () => {
    const shouldHandle = createNotificationDeduper()
    expect(shouldHandle('n1')).toBe(true)
    expect(shouldHandle('n2')).toBe(true)
    // n1 again, after n2 — still a real repeat of the most recent id only; this deduper is a
    // last-seen guard, not a full history, which is enough for the race it exists to close.
    expect(shouldHandle('n2')).toBe(false)
  })

  it('never suppresses when there is no id to compare — nothing to dedupe against', () => {
    const shouldHandle = createNotificationDeduper()
    expect(shouldHandle(undefined)).toBe(true)
    expect(shouldHandle(undefined)).toBe(true)
    expect(shouldHandle(null)).toBe(true)
  })
})

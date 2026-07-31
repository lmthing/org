/**
 * `isOffline` is the decision `useConnectivity` makes on every `expo-network` update — pulled out
 * so it is testable without the native module or React in the import graph, same rationale as
 * `./push-deeplink.test.ts`.
 */
import { describe, it, expect } from 'vitest'

import { isOffline } from './connectivity'

describe('isOffline', () => {
  it('is offline when there is no active connection at all', () => {
    expect(isOffline({ isConnected: false })).toBe(true)
  })

  it('is offline on Wi-Fi with no reachable internet — a captive portal, not a dropped radio', () => {
    expect(isOffline({ isConnected: true, isInternetReachable: false })).toBe(true)
  })

  it('is online when connected and reachability is confirmed', () => {
    expect(isOffline({ isConnected: true, isInternetReachable: true })).toBe(false)
  })

  it('is online when reachability has not been determined yet — never a false positive', () => {
    expect(isOffline({ isConnected: true })).toBe(false)
    expect(isOffline({})).toBe(false)
  })
})

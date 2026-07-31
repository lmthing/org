/**
 * Whether this phone currently has a network connection — the thing the app never told anyone.
 *
 * A dropped chat/team socket and an empty channel look identical from the transcript: both are
 * silence. Without a signal that names WHICH one this is, a member reads "nobody is talking" as
 * "the app is broken". This is the device-level half of that signal — `expo-network` reports the
 * OS's own connectivity state, independent of any one request's latency, which is what keeps it
 * from turning into the "scary banner on a slow request" this was asked not to be: a slow pod
 * response says nothing here at all, only an actual loss of connectivity does.
 *
 * `isOffline` is split out as a pure function (same reasoning as `./push-deeplink.ts`) so the
 * decision — which fields count as "offline" — is testable without `expo-network` or React in the
 * import graph. `useConnectivity` imports `expo-network` LAZILY, inside the effect, for the same
 * reason `./push.ts` imports `expo-notifications` lazily: it is a native module, and a shell that
 * cannot even resolve because a native module is not linked in this environment (a bare Metro
 * graph, a test harness) is a worse failure than a connectivity indicator that never appears.
 */
import * as React from 'react'

export type ConnectivityStatus = 'online' | 'offline' | 'unknown'

/** The subset of `expo-network`'s `NetworkState` this decision actually reads. */
export interface NetworkStateLike {
  isConnected?: boolean
  isInternetReachable?: boolean
}

/**
 * `isConnected: false` is unambiguous — no active network connection at all. `isInternetReachable:
 * false` is the OTHER real offline case: on Wi-Fi with no upstream (airport/hotel captive portal,
 * `NET_CAPABILITY_VALIDATED` failing on Android), where `isConnected` alone would read "fine" while
 * every request fails. Anything else — including both fields `undefined`, which happens transiently
 * on Android while the network request is still validating — is treated as online: a status this
 * module cannot yet determine must not read as a firm "you are offline".
 */
export function isOffline(state: NetworkStateLike): boolean {
  return state.isConnected === false || state.isInternetReachable === false
}

/**
 * Live connectivity status for the whole app. `'unknown'` only until the first native answer
 * arrives (there is no synchronous read), and native module load failure — the module is not
 * linked, which is exactly the state this app is in until a rebuild picks up the new dependency —
 * leaves it at `'unknown'` forever, which renders nothing rather than a banner that cannot be
 * trusted.
 */
export function useConnectivity(): ConnectivityStatus {
  const [status, setStatus] = React.useState<ConnectivityStatus>('unknown')

  React.useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void (async () => {
      try {
        const Network = await import('expo-network')
        const apply = (state: NetworkStateLike) => {
          if (cancelled) return
          setStatus(isOffline(state) ? 'offline' : 'online')
        }
        apply(await Network.getNetworkStateAsync())
        if (cancelled) return
        const subscription = Network.addNetworkStateListener(apply)
        unsubscribe = () => subscription.remove()
      } catch {
        // No native module linked, or the platform call itself failed — stay 'unknown' rather
        // than claim a state this device cannot actually report.
      }
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return status
}

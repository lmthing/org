/**
 * Registering this phone for notifications, and routing a tap on one.
 *
 * The gateway does not care that this is a phone — it stores a device endpoint
 * and picks a transport from its `kind`. So all this has to do is get Expo's push
 * token and hand it over; everything about FCM lives on the server side.
 *
 * `expo-notifications` is imported lazily, inside each function. It is a native
 * module: importing it at module scope makes this file unloadable in any context
 * that has not linked it (a bare Metro graph, a test harness), and a shell that
 * cannot boot because notifications are unavailable is a much worse failure than
 * no notifications.
 */

import { Platform } from 'react-native'

import { CLOUD_BASE_URL } from './hosts'
import { parseTeamDeepLink, createNotificationDeduper, type PushDeepLink } from './push-deeplink'

export { parseTeamDeepLink, type PushDeepLink }


/**
 * Ask for permission and register with the gateway. Returns the Expo token on
 * success, null on any refusal or failure.
 *
 * Never throws. Notifications are an addition to a surface that works without
 * them, and a permission dialog the member declined is a normal outcome, not an
 * error the app should report.
 */
export async function registerForPush(
  getAccessToken: () => Promise<string>,
): Promise<string | null> {
  try {
    const Notifications = await import('expo-notifications')

    // Android will not show a notification at all without a channel, and the
    // default one has no sound or heads-up behaviour — a message would arrive
    // silently into the shade, which reads as "push is broken".
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      })
    }

    const existing = await Notifications.getPermissionsAsync()
    const granted =
      existing.granted ||
      existing.status === 'granted' ||
      (await Notifications.requestPermissionsAsync()).granted

    if (!granted) return null

    const { data: token } = await Notifications.getExpoPushTokenAsync()
    if (!token) return null

    const accessToken = await getAccessToken()
    const res = await fetch(`${CLOUD_BASE_URL}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'expo',
        endpoint: token,
        label: Platform.OS === 'ios' ? 'iPhone' : 'Android',
      }),
    })
    return res.ok ? token : null
  } catch {
    // No native module linked, no network, a revoked permission — all of them
    // mean the same thing here.
    return null
  }
}

/**
 * Forget this device, on sign-out.
 *
 * `registerForPush` is idempotent on the endpoint (the gateway keys the row on it), which
 * is what makes asking Expo for the SAME token again here safe — it is not a new
 * registration, it is the address of the row to delete. Without this a signed-out device
 * keeps its subscription row and goes on receiving a stranger's team notifications the
 * moment somebody else signs into the same phone, which is a privacy bug, not a tidiness
 * one (`cloud/gateway/src/routes/push.ts#push.post('/unsubscribe')`).
 *
 * Never throws, on the same reasoning as `registerForPush`: signing out must complete
 * even when the push cleanup can't reach the gateway.
 */
export async function unregisterPush(getAccessToken: () => Promise<string>): Promise<void> {
  try {
    const Notifications = await import('expo-notifications')
    const { data: token } = await Notifications.getExpoPushTokenAsync()
    if (!token) return
    const accessToken = await getAccessToken()
    await fetch(`${CLOUD_BASE_URL}/api/push/unsubscribe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ endpoint: token }),
    })
  } catch {
    // No native module, no network, no token ever issued — sign-out proceeds regardless.
  }
}

/**
 * Wire a tap on a delivered notification to `onOpen`.
 *
 * A tap reaches this app two different ways and both have to be handled or "half the
 * feature" is what shipped: **already running** — `addNotificationResponseReceivedListener`
 * fires like any other event. **cold-started BY the tap** — the process did not exist yet
 * to have a listener, so the answer is asked for once, after mount
 * (`getLastNotificationResponseAsync`). Missing either one means the deep link works only
 * when the app happened to already be open, which is the one case a notification tap is
 * least likely to be in.
 *
 * Wiring both paths risks handling the SAME tap twice — Expo's own docs note the cold-start
 * check and the live listener can both fire for one delivered notification in the same launch —
 * so every response is deduped by its own `request.identifier` first
 * (`./push-deeplink.ts#createNotificationDeduper`). That guard only ever suppresses a REPEAT of
 * the exact same id; two different notifications arriving moments apart both still open, which is
 * the case a naive "ignore anything while one is in flight" debounce would have gotten wrong.
 *
 * Never throws — same contract as `registerForPush`.
 */
export async function watchPushDeepLinks(
  onOpen: (link: PushDeepLink) => void,
): Promise<() => void> {
  try {
    const Notifications = await import('expo-notifications')
    const shouldHandle = createNotificationDeduper()

    const handle = (
      response: {
        notification: { request: { identifier?: string; content: { data?: Record<string, unknown> } } }
      } | null,
    ) => {
      if (!shouldHandle(response?.notification.request.identifier)) return
      const url = response?.notification.request.content.data?.['url']
      if (typeof url !== 'string') return
      const link = parseTeamDeepLink(url)
      if (link) onOpen(link)
    }

    void Notifications.getLastNotificationResponseAsync().then(handle)
    const subscription = Notifications.addNotificationResponseReceivedListener(handle)
    return () => subscription.remove()
  } catch {
    // No native module linked — nothing to wire up, nothing to unwind.
    return () => {}
  }
}

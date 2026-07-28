/**
 * Registering this phone for notifications.
 *
 * The gateway does not care that this is a phone — it stores a device endpoint
 * and picks a transport from its `kind`. So all this has to do is get Expo's push
 * token and hand it over; everything about FCM lives on the server side.
 *
 * `expo-notifications` is imported lazily, inside the function. It is a native
 * module: importing it at module scope makes this file unloadable in any context
 * that has not linked it (a bare Metro graph, a test harness), and a shell that
 * cannot boot because notifications are unavailable is a much worse failure than
 * no notifications.
 */

import { Platform } from 'react-native'

const CLOUD_BASE_URL = 'https://lmthing.cloud'

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

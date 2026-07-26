import { Linking } from 'react-native'
import * as ExpoLinking from 'expo-linking'

/**
 * Leaving the app, and coming back — NATIVE implementation.
 *
 * `openUrl` is real: a cross-surface link (studio, today) hands off to the system browser, which is
 * the correct behaviour until those surfaces exist in the app. When studio lands here this becomes
 * an in-app route and the call site does not change — which is the point of naming the seam after
 * the intent rather than after `window.location`.
 *
 * `reloadApp` and `setAppTitle` are honest no-ops. A React Native app is not a document: there is no
 * page to reload (the pod restarting does not invalidate the JS bundle) and no tab to title. Doing
 * nothing is the correct behaviour, not a missing feature.
 */
export function openUrl(url: string): void {
  void Linking.openURL(url).catch(() => {
    /* no handler for the scheme — nothing sensible to do but stay put */
  })
}

/**
 * Where an external flow should send the user back to: this app's own scheme. `Linking.createURL('')`
 * yields `lmthing://` in a standalone build and the Expo Go URL in development, so a billing or
 * GitHub-connect round trip returns to the app rather than to a web page it cannot reach.
 */
export function currentUrl(): string {
  return ExpoLinking.createURL('')
}

export function reloadApp(): void {
  // Deliberately nothing. The app's JS is bundled locally; the pod restarting is a server event the
  // next request will simply succeed against.
}

export function setAppTitle(_title: string): void {
  // Deliberately nothing — no tab, no title bar.
}

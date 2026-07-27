import * as Clipboard from 'expo-clipboard'

/**
 * Clipboard — NATIVE implementation (Expo Clipboard). Mirrors `clipboard.ts` (web). Was
 * `@react-native-clipboard/clipboard`, a third-party native module Expo Go does not link — every
 * device run crashed at boot with `TurboModuleRegistry.getEnforcing(...): 'RNCClipboard' could not
 * be found` the moment anything reachable from `ChatShell` touched it. `expo-clipboard` is the
 * Expo-SDK equivalent, so it works the same way every other `platform/*.native.ts` seam in this
 * package already does (`expo-secure-store`, `expo-web-browser`, `expo-crypto`, `expo-linking`):
 * no custom dev client, testable in Expo Go. Requires `expo-clipboard` in the mobile app.
 */
export const clipboard = {
  async writeText(text: string): Promise<boolean> {
    try {
      return await Clipboard.setStringAsync(text)
    } catch {
      return false
    }
  },
  async readText(): Promise<string> {
    try {
      return await Clipboard.getStringAsync()
    } catch {
      return ''
    }
  },
}

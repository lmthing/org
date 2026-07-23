import Clipboard from '@react-native-clipboard/clipboard'

/**
 * Clipboard — NATIVE implementation (RN Clipboard). Mirrors `clipboard.ts` (web). Requires
 * `@react-native-clipboard/clipboard` in the mobile app (verified there). See §7 step 8.
 */
export const clipboard = {
  async writeText(text: string): Promise<boolean> {
    try {
      Clipboard.setString(text)
      return true
    } catch {
      return false
    }
  },
  async readText(): Promise<string> {
    try {
      return await Clipboard.getString()
    } catch {
      return ''
    }
  },
}

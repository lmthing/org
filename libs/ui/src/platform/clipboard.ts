/**
 * Clipboard — WEB implementation (`navigator.clipboard`). Native counterpart uses RN Clipboard.
 * Behind the `platform/` seam (§7 step 8). Web behavior verbatim; falls back to `false` when the
 * API is unavailable (insecure context), as the current code does.
 */
export const clipboard = {
  async writeText(text: string): Promise<boolean> {
    try {
      await globalThis.navigator?.clipboard?.writeText(text)
      return true
    } catch {
      return false
    }
  },
  async readText(): Promise<string> {
    try {
      return (await globalThis.navigator?.clipboard?.readText()) ?? ''
    } catch {
      return ''
    }
  },
}

/**
 * Haptics — NATIVE implementation (`expo-haptics`). Mirrors `haptics.ts` (web, all no-ops).
 *
 * Imported LAZILY, the same way `apps/mobile/src/push.ts` reaches `expo-notifications`: this is a
 * native module, so a build that does not link it — Expo Go, an older dev client, a web bundle
 * that somehow resolved this fork — must still boot rather than crash at import time with
 * `TurboModuleRegistry.getEnforcing(...)`. That failure mode has bitten this package before, and
 * feedback is exactly the kind of nicety that must never be able to take the app down.
 *
 * Every call is fire-and-forget and swallows its error. A buzz that did not happen is not worth a
 * rejected promise reaching a caller who only wanted to send a message, and an unhandled rejection
 * here would be reported as a crash by anything watching.
 *
 * Requires `expo-haptics` in the host app.
 */
type HapticsModule = {
  notificationAsync: (t: unknown) => Promise<void>
  impactAsync: (s: unknown) => Promise<void>
  NotificationFeedbackType: { Success: unknown; Warning: unknown }
  ImpactFeedbackStyle: { Light: unknown }
}

let mod: HapticsModule | null | undefined

function load(): HapticsModule | null {
  if (mod !== undefined) return mod
  try {
    // A LAZY require, deliberately — the whole point of this seam is that the module may not be
    // installed, and the `catch` below is what makes that survivable. An `import` is hoisted and
    // evaluated before this function can guard it, so converting this would move the failure to
    // module load, where nothing can catch it. Not reachable on web: Metro picks the `.native` fork.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-haptics') as HapticsModule
  } catch {
    mod = null
  }
  return mod
}

function fire(run: (m: HapticsModule) => Promise<void>): void {
  const m = load()
  if (!m) return
  try {
    void run(m).catch(() => undefined)
  } catch {
    /* a device with no haptic engine, or a module that linked but cannot fire — never fatal */
  }
}

export const haptics = {
  success(): void {
    fire((m) => m.notificationAsync(m.NotificationFeedbackType.Success))
  },
  warning(): void {
    fire((m) => m.notificationAsync(m.NotificationFeedbackType.Warning))
  },
  light(): void {
    fire((m) => m.impactAsync(m.ImpactFeedbackStyle.Light))
  },
}

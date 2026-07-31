/**
 * Restrained physical feedback, re-exported from the shared platform seam.
 *
 * This began as its own `expo-haptics` wrapper here, which was the only option available at the
 * time: the app can import `libs/ui`, but `libs/ui` cannot import the app — and the interactions
 * that most want a buzz (sending a message, opening a thread, the long-press that reveals a reply)
 * all live in shared surfaces this file could never reach. So they stayed silent.
 *
 * `@lmthing/ui/platform` now owns it (`haptics.ts` / `haptics.native.ts`), which puts the
 * implementation where BOTH sides can call it. Keeping this module as a re-export rather than
 * deleting it leaves the app's own call sites reading naturally — pod-start failure, a team-list
 * refresh that failed, the tap-ack on opening a project — while there is exactly one wrapper
 * around the native module instead of two that will drift.
 *
 * The behaviour is unchanged: lazily imported, never throws, and a no-op wherever the module is
 * not linked or the device has no haptic engine. The web fork is all no-ops by design; see the
 * seam for why that is the contract rather than a gap.
 *
 * These stay `async` so the existing `void hapticX()` call sites keep their shape; the seam itself
 * is fire-and-forget and already swallows everything.
 */
import { haptics } from '@lmthing/ui/platform'

/** A send, an open, a completion — the ONE positive confirmation this app gives a thumb. */
export async function hapticSuccess(): Promise<void> {
  haptics.success()
}

/** A failed request, a fetch that came back an error — the one warning cue. */
export async function hapticWarning(): Promise<void> {
  haptics.warning()
}

/**
 * A light tap acknowledgement — reserved for the one place in this app where a press kicks off a
 * network round trip with NO other visible change until it resolves (`TeamScreen`'s `onOpenApp`
 * probe): without it the tap reads as having done nothing at all, on a screen with no spinner to
 * say otherwise. Not for ordinary buttons — those already redraw immediately and a buzz on every
 * one of them is exactly the noise this module exists to avoid.
 */
export async function hapticLight(): Promise<void> {
  haptics.light()
}

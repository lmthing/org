/**
 * Haptics — WEB implementation. Every call is a no-op, and that is the whole point.
 *
 * A laptop has no haptic engine, and the Vibration API that some browsers expose is a blunt
 * buzz meant for notifications rather than the light confirmation tap this is for — using it
 * would be worse than silence.
 *
 * The seam exists so a shared surface can say "this action succeeded" ONCE, at the place the
 * action happens, instead of the phone app trying to reach back into `libs/ui` to wire feedback
 * onto controls it does not own. That is the direction the dependency actually runs, and it is
 * why sending a message, opening a thread and long-pressing to reply were all silent on a device:
 * the only code that could feel the press lived in a package that could not import the haptics.
 */
export const haptics = {
  /** A completed action: a message sent, a thread opened. */
  success(): void {},
  /** Something the person will have to deal with: a send that failed, a lost connection. */
  warning(): void {},
  /** Acknowledging a press that starts something slow, so the tap does not feel ignored. */
  light(): void {},
}

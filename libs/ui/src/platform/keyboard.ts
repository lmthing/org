/**
 * Global key handling — WEB implementation (`document` keydown).
 *
 * Overlays close on Escape and the shell has a few shortcuts; both listened on `document` directly,
 * which is the one object React Native does not have.
 *
 * The seam is deliberately narrow — `onDismiss` and `onKey` rather than "add a DOM listener" —
 * because the native equivalent is not a keyboard at all. Exposing `addEventListener` would have
 * made the web shape the interface and left the native fork pretending to implement it.
 */

/**
 * Run `handler` when the user asks to dismiss the topmost thing (Escape on web; the Android back
 * gesture on native). Returns an unsubscribe fn.
 */
export function onDismiss(handler: () => void): () => void {
  const listener = (event: KeyboardEvent) => {
    if (event.key === 'Escape') handler()
  }
  document.addEventListener('keydown', listener)
  return () => document.removeEventListener('keydown', listener)
}

/** Raw key events, for shell shortcuts. Never fires on native — there is no hardware keyboard. */
export function onKeyDown(handler: (event: KeyboardEvent) => void): () => void {
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

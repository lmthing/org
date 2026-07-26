import { BackHandler } from 'react-native'

/**
 * Global key handling — NATIVE implementation.
 *
 * There is no keyboard, but there IS a dismiss gesture: Android's back button. Mapping it onto the
 * same `onDismiss` the overlays already use means a sheet or dialog closes the way a user expects,
 * from the same one line of shared code that binds Escape on web.
 *
 * `BackHandler`'s listener returns `true` to say "handled, do not exit the app" — which is exactly
 * right for an open overlay, and exactly why this is not a no-op fork.
 */
export function onDismiss(handler: () => void): () => void {
  const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    handler()
    return true
  })
  return () => subscription.remove()
}

/**
 * Raw key events. A no-op here: iOS and Android have no hardware keyboard to listen to, and the
 * shortcuts this carries on web (`?`, `/`) have no gesture equivalent worth inventing. Returning an
 * unsubscribe keeps the caller identical on both targets.
 */
export function onKeyDown(_handler: (event: unknown) => void): () => void {
  return () => {}
}

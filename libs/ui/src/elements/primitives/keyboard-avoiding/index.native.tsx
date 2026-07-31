/**
 * KeyboardAvoiding — NATIVE fork. The thing that stops the on-screen keyboard covering whatever
 * you are typing into.
 *
 * React Native does not move a layout out of the keyboard's way. A composer pinned to the bottom
 * of the screen stays exactly where it is and the keyboard is drawn ON TOP of it, so you cannot
 * see the text you are entering — and on a chat surface, where the composer is the point of the
 * screen, that is most of the screen's usefulness gone. Nothing in this repo did anything about
 * it: there was no `KeyboardAvoidingView` anywhere in `libs/ui`, and `platform/keyboard.native.ts`
 * is an explicit no-op for the web `onKeyDown` seam, not this.
 *
 * The two platforms genuinely differ, which is why this is not one setting:
 *
 * - **iOS** gives the app no help at all: the OS reports the keyboard's frame and the app is
 *   expected to inset itself. `behavior="padding"` is the RN idiom for a container whose child
 *   should shrink rather than slide.
 * - **Android** already resizes the window when `windowSoftInputMode` is `adjustResize` (Expo's
 *   default), so the layout has ALREADY shrunk by the time this component would act. Applying
 *   `padding` there as well subtracts the keyboard's height a second time and leaves a gap the
 *   size of the keyboard above it — the bug looks like "the composer floats halfway up the
 *   screen". So Android passes `undefined`, which is RN's documented answer, not an oversight.
 *
 * `keyboardOffset` is for a header drawn OUTSIDE this container: without it the inset is measured
 * from the wrong origin and the composer ends up short by exactly that header's height.
 */
import * as React from 'react'
import { KeyboardAvoidingView, Platform } from 'react-native'

import { nativeSafeProps } from '../_native'
import type { ColProps } from '../col/index'

export interface KeyboardAvoidingProps extends ColProps {
  /** Extra space between the keyboard and the avoided content — a header's height, typically. */
  keyboardOffset?: number
}

/**
 * Which inset strategy this platform needs, as a value rather than an inline ternary.
 *
 * Exported because it cannot be observed from the outside: `KeyboardAvoidingView` renders a plain
 * `View` host and only applies its padding once a keyboard is actually on screen, so a render
 * suite sees nothing either way. Asserting the DECISION is the honest half of the test; that it
 * mounts at all is the other.
 */
export function keyboardBehavior(os: string): 'padding' | undefined {
  return os === 'ios' ? 'padding' : undefined
}

const KeyboardAvoiding = React.forwardRef<any, KeyboardAvoidingProps>(
  ({ keyboardOffset, children, ...props }, ref) => (
    <KeyboardAvoidingView
      ref={ref}
      behavior={keyboardBehavior(Platform.OS)}
      {...(keyboardOffset !== undefined ? { keyboardVerticalOffset: keyboardOffset } : null)}
      {...nativeSafeProps(props as Record<string, unknown>, { flexDirectionDefault: 'column' })}
    >
      {children}
    </KeyboardAvoidingView>
  ),
)
KeyboardAvoiding.displayName = 'KeyboardAvoiding'

export { KeyboardAvoiding }

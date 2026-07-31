/**
 * KeyboardAvoiding — WEB fork. A passthrough, and deliberately so.
 *
 * A browser resizes (or scrolls) its own viewport when a soft keyboard appears, so there is
 * nothing for a component to do here. This exists as a primitive rather than as native-only code
 * at each call site for the usual reason: a surface that has to remember to wrap itself only on
 * one target is a surface that will forget.
 *
 * The whole behaviour lives in `index.native.tsx`. See it for what this is FOR — on a phone the
 * composer is simply covered by the keyboard, and you cannot see what you are typing.
 */
import * as React from 'react'

import { Col, type ColProps } from '../col/index'

export interface KeyboardAvoidingProps extends ColProps {
  /**
   * Extra space between the keyboard and the avoided content — a header's height, typically,
   * where one is drawn outside this container. Native only; ignored on web.
   */
  keyboardOffset?: number
}

const KeyboardAvoiding = React.forwardRef<any, KeyboardAvoidingProps>(
  ({ keyboardOffset: _keyboardOffset, ...props }, ref) => <Col ref={ref} {...props} />,
)
KeyboardAvoiding.displayName = 'KeyboardAvoiding'

export { KeyboardAvoiding }

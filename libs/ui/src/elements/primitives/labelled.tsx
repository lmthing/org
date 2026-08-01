/**
 * Wrap bare string/number children in a `Text`, so a component that renders arbitrary children into
 * a non-text host is safe on React Native.
 *
 * React Native raises "Text strings must be rendered within a `<Text>` component" and then DROPS
 * the string, so the failure is a label that silently vanishes — or, in the new architecture, an
 * error surfaced in the log while the menu item renders empty. On web the same markup is ordinary
 * and correct, which is why it is written that way everywhere and why nothing catches it until a
 * device runs it.
 *
 * Shared rather than copied because it is not a one-off: `Button` had its own private copy, and
 * every other leaf that spreads `children` into a `Pressable` or `Box` — the menu items, the
 * option rows — had the same bug and no copy. A single helper is also what lets one test assert
 * the property across all of them (`metro/suites/string-children.tsx`).
 *
 * Only strings and numbers are touched: an icon, or a caller's own `<Text>`, passes through
 * unchanged. On web this adds a `<span>`, which inherits the surrounding typography and changes
 * nothing visually.
 *
 * Every call site could wrap its own label. But a menu item whose label vanishes on one platform is
 * the menu item's bug, not each caller's — and there were 60-odd call sites and one of them was
 * always going to be written the obvious way.
 *
 * ## `textProps` — because the wrapper CANNOT inherit on native
 *
 * On web the added `<span>` inherits `color`, `font-size` and `font-weight` from the element it sits
 * in, so a `Button` styling itself `color: '$primary-foreground'` styles its label for free. **On
 * native there is nothing to inherit from.** The container is a `Pressable`, which is an RN `View`,
 * and a `View` has no text colour or size — those declarations are dropped there. Worse,
 * `primitives/_native.tsx#NativeText` sets `color`/`fontFamily` as styled DEFAULTS, which are
 * unconditional, so the label actively resolves to body ink rather than to nothing.
 *
 * Measured on an emulator: every primary `Button` in the app rendered its label in `$foreground` on
 * a `$primary` fill — 1.4:1 in light, 2.2:1 in dark, i.e. an unreadable label on the app's main call
 * to action, in BOTH themes. It had been that way since the primitives were forked and no gate could
 * see it, because on web the same markup is correct.
 *
 * So a container that styles its own text must hand those values down. `textProps` is that channel.
 */
import * as React from 'react'

import { Text, type TextProps } from './text/index'

/** The subset a container can meaningfully pass to a label it did not write. */
export type LabelStyle = Pick<TextProps, 'color' | 'fontSize' | 'fontWeight' | 'fontFamily'>

export function labelled(children: React.ReactNode, textProps?: LabelStyle): React.ReactNode {
  // Absent keys are DROPPED rather than forwarded as `undefined`. Tamagui treats an explicitly
  // passed `undefined` as an override, so spreading `{ color: undefined }` clobbers `NativeText`'s
  // `$foreground` default and the label falls back to the platform's near-black — reintroducing the
  // very bug this channel exists to fix, on exactly the variants that style nothing (`ghost`,
  // `outline`). A container passing "I have no opinion" must say nothing at all.
  const style = textProps
    ? (Object.fromEntries(Object.entries(textProps).filter(([, v]) => v !== undefined)) as LabelStyle)
    : undefined
  return React.Children.map(children, (child) =>
    typeof child === 'string' || typeof child === 'number' ? <Text {...style}>{child}</Text> : child,
  )
}

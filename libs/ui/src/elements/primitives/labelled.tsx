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
 */
import * as React from 'react'

import { Text } from './text/index'

export function labelled(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) =>
    typeof child === 'string' || typeof child === 'number' ? <Text>{child}</Text> : child,
  )
}

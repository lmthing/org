import * as React from 'react'

/**
 * Pressable — the clickable primitive (Phase 0): a `<button>` (or `<a>`/`<div>` via `as`).
 *
 * PURE PASSTHROUGH `forwardRef` wrapper — renders the tag with the caller's props verbatim, so
 * replacing a raw `<button>` (or a clickable `<div>`) produces byte-identical HTML. In Phase 1
 * its internals become a Tamagui `Pressable`: on web it still renders `<button>`/role and maps
 * `onPress`→`onClick`; on native it is an RN `Pressable` (§4).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type PressableAs = 'button' | 'a' | 'div'

// Button-based (the default tag) plus the anchor-specific attributes used when `as="a"`. Kept a
// button base rather than a button&anchor intersection so spreading plain button props (the
// common case, e.g. chat's <Button>) stays assignable — the intersection over-constrains.
export type PressableProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  Pick<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'href' | 'target' | 'rel' | 'download' | 'referrerPolicy' | 'hrefLang'
  > & {
    /** Host tag to render. Defaults to `button`. Use `a` for links, `div` for clickable boxes. */
    as?: PressableAs
  }

const Pressable = React.forwardRef<HTMLElement, PressableProps>(({ as, ...props }, ref) =>
  React.createElement((as ?? 'button') as string, { ...props, ref }),
)
Pressable.displayName = 'Pressable'

export { Pressable }

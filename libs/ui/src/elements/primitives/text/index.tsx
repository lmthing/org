import * as React from 'react'

/**
 * Text — the generic inline / body-text primitive (Phase 0).
 *
 * PURE PASSTHROUGH `forwardRef` wrapper: renders the chosen tag with the caller's props
 * verbatim. Defaults to `<span>`; `block` renders `<p>`; `as` selects any inline text tag
 * (`strong`/`em`/`small`/`label`/`kbd`/…) or a heading (`h1`–`h6`). Absorbs the inline text and
 * heading tags across the surfaces with no visual change. Phase 1 swaps its internals to a
 * Tamagui `Text` mapping font tokens (§4). (Distinct
 * from the styled `typography/heading`, which adds `heading-*` classes.)
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type TextAs =
  | 'span'
  | 'p'
  | 'strong'
  | 'em'
  | 'b'
  | 'i'
  | 'small'
  | 'label'
  | 'code'
  | 'kbd'
  | 'dt'
  | 'dd'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'

export type TextProps = React.HTMLAttributes<HTMLElement> & {
  /** Inline text tag to render. Defaults to `span` (or `p` when `block`). */
  as?: TextAs
  /** Convenience: render a block `<p>` instead of an inline `<span>`. */
  block?: boolean
  /** Passed through when `as="label"`. */
  htmlFor?: string
}

const Text = React.forwardRef<HTMLElement, TextProps>(({ as, block, ...props }, ref) =>
  React.createElement((as ?? (block ? 'p' : 'span')) as string, { ...props, ref }),
)
Text.displayName = 'Text'

export { Text }

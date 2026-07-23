import * as React from 'react'

/**
 * Text — the generic inline / body-text primitive (Phase 0).
 *
 * Pure passthrough: renders the chosen tag with the caller's props verbatim. Defaults to
 * `<span>`; `block` renders `<p>`; `as` selects any inline text tag (`strong`/`em`/`small`/
 * `label`/…). Absorbs the ~235 span/p/strong/em/small tags across the surfaces with no
 * visual change. Phase 1 swaps its internals to a Tamagui `Text` mapping font tokens (§4).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type TextAs = 'span' | 'p' | 'strong' | 'em' | 'b' | 'i' | 'small' | 'label' | 'code'

export type TextProps = React.HTMLAttributes<HTMLElement> & {
  /** Inline text tag to render. Defaults to `span` (or `p` when `block`). */
  as?: TextAs
  /** Convenience: render a block `<p>` instead of an inline `<span>`. */
  block?: boolean
  /** Passed through when `as="label"`. */
  htmlFor?: string
}

function Text({ as, block, ...props }: TextProps) {
  const Tag = (as ?? (block ? 'p' : 'span')) as React.ElementType
  return <Tag {...props} />
}

export { Text }

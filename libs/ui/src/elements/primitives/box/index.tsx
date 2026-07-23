import * as React from 'react'

/**
 * Box — the generic block container primitive (Phase 0 of the Tamagui migration).
 *
 * It is a PURE PASSTHROUGH wrapper: it renders its tag with the caller's props applied
 * verbatim (className included, unmodified), so replacing a raw `<div>`/`<section>`/… in
 * chat/studio/computer with `<Box>` produces byte-identical HTML and identical computed
 * styles. The only transformation is choosing the tag via `as`.
 *
 * In Phase 1 this component's INTERNALS become a Tamagui `styled()` primitive with the
 * block-compat box-model resets (§4); the surfaces that use `<Box>` are not edited again.
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type BoxAs =
  | 'div'
  | 'section'
  | 'nav'
  | 'header'
  | 'footer'
  | 'aside'
  | 'article'
  | 'main'
  | 'figure'
  | 'figcaption'

export type BoxProps = React.HTMLAttributes<HTMLElement> & {
  /** Semantic host tag to render. Defaults to `div`. */
  as?: BoxAs
}

function Box({ as, ...props }: BoxProps) {
  const Tag = (as ?? 'div') as React.ElementType
  return <Tag {...props} />
}

export { Box }

import * as React from 'react'

/**
 * Image — the `<img>` primitive (Phase 0). Pure passthrough. Phase 1 swaps its internals to
 * a Tamagui `Image` (web `<img>`, native `react-native` Image).
 *
 * See docs/react-native-tamagui-migration.md §1.5.
 */
export type ImageProps = React.ImgHTMLAttributes<HTMLImageElement>

function Image(props: ImageProps) {
  // eslint-disable-next-line jsx-a11y/alt-text -- passthrough; alt is the caller's responsibility
  return <img {...props} />
}

export { Image }

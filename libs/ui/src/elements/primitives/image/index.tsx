import * as React from 'react'
import { hostPrimitive } from '../_host'

/**
 * Image — the `<img>` primitive (Phase 0). Pure passthrough. Phase 1 swaps its internals to a
 * Tamagui `Image` (web `<img>`, native `react-native` Image).
 *
 * See docs/react-native-tamagui-migration.md §1.5.
 */
export type ImageProps = React.ImgHTMLAttributes<HTMLImageElement>

const Image = hostPrimitive<HTMLImageElement, ImageProps>('img', 'Image')

export { Image }

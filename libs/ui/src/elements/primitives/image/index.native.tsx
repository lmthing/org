import * as React from 'react'
import { Image as RNImage } from 'react-native'

/**
 * Image (native fork). Maps the web `<img>` props onto a React Native `Image`: `src` → `source.uri`,
 * `alt` → `accessibilityLabel`. Same prop shape as the web `Image` so surfaces are cross-target.
 * Web keeps `index.tsx`. (Typechecked in the mobile app, which provides react-native types.)
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
// Mirrors the web `ImagePrimitiveProps` surface so a surface can pass style props on both
// targets; the RN fork consumes only `src`/`alt`/`style` and ignores the rest.
export type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown>

const Image = React.forwardRef<React.ElementRef<typeof RNImage>, ImageProps>(
  ({ src, alt, style }, ref) => (
    <RNImage
      ref={ref}
      source={typeof src === 'string' ? { uri: src } : undefined}
      accessibilityLabel={alt}
      style={style as never}
    />
  ),
)
Image.displayName = 'Image'

export { Image }

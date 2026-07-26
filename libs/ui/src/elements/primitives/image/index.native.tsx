import * as React from 'react'
import { Image as RNImage } from 'react-native'

/**
 * Image (native fork). Maps the web `<img>` props onto a React Native `Image`: `src` → `source.uri`,
 * `alt` → `accessibilityLabel`. Same prop shape as the web `Image` so surfaces are cross-target.
 * Web keeps `index.tsx`. (Typechecked in the mobile app, which provides react-native types.)
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
/**
 * The SAME props type the web sibling exports, imported rather than redeclared. A redeclared
 * `React.*HTMLAttributes` was never checked against anything: `tsc` only ever resolves `index.tsx`,
 * so the fork's own claim about its props could disagree with both the caller and the
 * implementation. `import type` is erased by the transform, so `_tamagui.tsx` stays out of the
 * native graph (verified against the graph, not assumed).
 */
import type { ImagePrimitiveProps } from '../_tamagui'

export type ImageProps = ImagePrimitiveProps

const Image = React.forwardRef<React.ElementRef<typeof RNImage>, ImageProps>(
  ({ src, alt, style }, ref) => (
    <RNImage
      ref={ref}
      source={typeof src === 'string' ? { uri: src } : undefined}
      // `ImageProps` intersects `Record<string, unknown>` so surfaces can pass the web fork's style
      // props, which widens every known prop to `unknown` — hence the guard, matching `src` above.
      accessibilityLabel={typeof alt === 'string' ? alt : undefined}
      style={style as never}
    />
  ),
)
Image.displayName = 'Image'

export { Image }

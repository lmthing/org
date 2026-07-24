/**
 * Link — the anchor primitive, now a real Tamagui primitive (Part III / B3.4-leaf). Renders a real
 * `<a>` via per-tag `createComponent` (`isText`, display inline), reproducing a plain anchor
 * (font/line-height inherit; margins/display lift to props). The `index.native.tsx` fork is the RN
 * target (`Linking.openURL`). See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export { Link, type LinkProps } from '../_tamagui'

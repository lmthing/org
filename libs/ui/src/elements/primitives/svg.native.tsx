/**
 * SVG-family primitives (native fork). The web primitives were deliberately named to MIRROR
 * `react-native-svg`'s component names, so the native fork is a direct re-export — inline icons
 * render on native with no surface edits. `SvgText`/`Tspan` alias RN-svg's `Text`/`TSpan` (which
 * would otherwise collide with the text primitive). Metro prefers this `.native.tsx`.
 * (Typechecked in the mobile app, which provides react-native-svg.)
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export {
  Svg,
  Path,
  Rect,
  Circle,
  Ellipse,
  Line,
  Polyline,
  Polygon,
  G,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Text as SvgText,
  TSpan as Tspan,
  Use,
  ClipPath,
  Mask,
} from 'react-native-svg'

// Phase-0 vocabulary primitives — plain-HTML pure-passthrough (forwardRef) wrappers that let
// chat/studio/computer speak a single component vocabulary (no raw host tags). In Phase 1 only
// these components' internals swap to Tamagui; the surfaces are not edited again.
// See docs/react-native-tamagui-migration.md §1.5.
export { Box, type BoxProps, type BoxAs } from './box/index.tsx'
export { Text, type TextProps, type TextAs } from './text/index.tsx'
export { Pressable, type PressableProps, type PressableAs } from './pressable/index.tsx'
export { Row, type RowProps } from './row/index.tsx'
export { Col, type ColProps } from './col/index.tsx'
export { Image, type ImageProps } from './image/index.tsx'
export { Link, type LinkProps } from './link/index.tsx'
export { Form, type FormProps } from './form/index.tsx'
export { List, ListItem, type ListProps, type ListItemProps } from './list/index.tsx'

// Grouped primitives.
export {
  TextField,
  type TextFieldProps,
  TextArea,
  type TextAreaProps,
  Select,
  type SelectProps,
  Option,
  type OptionProps,
} from './controls.tsx'
export { Audio, type AudioProps, Video, type VideoProps, IFrame, type IFrameProps } from './media.tsx'
export { Table, Thead, Tbody, Tfoot, Tr, Th, Td, Caption } from './table.tsx'
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
  SvgText,
  Tspan,
  Use,
  ClipPath,
  Mask,
} from './svg.tsx'
export { Pre, type PreProps, Br, type BrProps, Hr, type HrProps } from './misc.tsx'

// Phase-0 vocabulary primitives — plain-HTML pure-passthrough (forwardRef) wrappers that let
// chat/studio/computer speak a single component vocabulary (no raw host tags). In Phase 1 only
// these components' internals swap to Tamagui; the surfaces are not edited again.
// See docs/react-native-tamagui-migration.md §1.5.
export { Box, type BoxProps, type BoxAs } from './box/index'
export { Text, type TextProps, type TextAs } from './text/index'
export { Pressable, type PressableProps, type PressableAs } from './pressable/index'
export { Row, type RowProps } from './row/index'
export { Col, type ColProps } from './col/index'
export { Image, type ImageProps } from './image/index'
export { Link, type LinkProps } from './link/index'
export { Form, type FormProps } from './form/index'
export { List, ListItem, type ListProps, type ListItemProps } from './list/index'

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
} from './controls'
export { Audio, type AudioProps, Video, type VideoProps, IFrame, type IFrameProps } from './media'
export { Table, Thead, Tbody, Tfoot, Tr, Th, Td, Caption } from './table'
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
} from './svg'
export { Pre, type PreProps, Br, type BrProps, Hr, type HrProps, DataList, type DataListProps } from './misc'

// Phase-0 vocabulary primitives — plain-HTML wrappers that let chat/studio/computer speak a
// single component vocabulary (no raw host tags). In Phase 1 only these components' internals
// swap to Tamagui; the surfaces are not edited again.
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

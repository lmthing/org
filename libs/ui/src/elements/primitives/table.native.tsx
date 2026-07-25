import * as React from 'react'
import { styled, View } from './_native'
import { NativeView, NativeText, nativeSafeProps } from './_native'

/**
 * Table-family primitives (native fork). RN has no table layout, so these render as flex
 * containers: sections/rows as Views (`Tr` is a flex-row), cells as Views, caption as Text. Same
 * symbols + prop shapes as `table.tsx` (web). Metro prefers this `.native.tsx`.
 * See docs/react-native-tamagui-migration.md §1.5 / §7.
 */
const RowView: React.ComponentType<any> = styled(View, {
  name: 'Tr',
  flexDirection: 'row',
}) as unknown as React.ComponentType<any>

const cell = (name: string) => {
  const C = React.forwardRef<any, React.HTMLAttributes<HTMLElement>>(({ children, ...props }, ref) => (
    <NativeView ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeView>
  ))
  C.displayName = name
  return C
}

export const Table = cell('Table')
export const Thead = cell('Thead')
export const Tbody = cell('Tbody')
export const Tfoot = cell('Tfoot')

export const Tr = React.forwardRef<any, React.HTMLAttributes<HTMLElement>>(
  ({ children, ...props }, ref) => (
    <RowView ref={ref} {...nativeSafeProps(props)}>
      {children}
    </RowView>
  ),
)
Tr.displayName = 'Tr'

export const Th = cell('Th')
export const Td = cell('Td')

export const Caption = React.forwardRef<any, React.HTMLAttributes<HTMLElement>>(
  ({ children, ...props }, ref) => (
    <NativeText ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeText>
  ),
)
Caption.displayName = 'Caption'

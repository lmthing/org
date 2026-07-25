import * as React from 'react'
import { NativeView, NativeText } from './_native'

/**
 * Misc primitives (native fork): `Pre` → a monospace RN Text block, `Br` → nothing (RN Text wraps),
 * `Hr` → a hairline RN View. Same prop shapes as `misc.tsx` (web). Metro prefers this `.native.tsx`.
 * See docs/react-native-tamagui-migration.md §1.5 / §7.
 */
export type PreProps = React.HTMLAttributes<HTMLPreElement>
export const Pre = React.forwardRef<any, PreProps>(({ children, style }, ref) => (
  <NativeText ref={ref} style={style as never}>
    {children}
  </NativeText>
))
Pre.displayName = 'Pre'

export type BrProps = React.HTMLAttributes<HTMLBRElement>
export const Br = React.forwardRef<any, BrProps>(() => null)
Br.displayName = 'Br'

export type HrProps = React.HTMLAttributes<HTMLHRElement>
export const Hr = React.forwardRef<any, HrProps>(({ style }, ref) => (
  <NativeView ref={ref} style={style as never} />
))
Hr.displayName = 'Hr'

/** `<datalist>` has no RN analogue — the browser-only autocomplete source renders nothing. */
export type DataListProps = React.HTMLAttributes<HTMLDataListElement>
export const DataList = React.forwardRef<any, DataListProps>(() => null)
DataList.displayName = 'DataList'

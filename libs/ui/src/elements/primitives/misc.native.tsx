import * as React from 'react'
import { NativeView, NativeText, nativeSafeProps } from './_native'

/**
 * Misc primitives (native fork): `Pre` → a monospace RN Text block, `Br` → nothing (RN Text wraps),
 * `Hr` → a hairline RN View. `Pre`'s mono family and `Hr`'s rule are token-backed DEFAULTS, spread
 * before the caller's props so either can still be overridden — the web versions get the same from
 * their tag's user-agent styles, which native has none of. Same prop shapes as `misc.tsx` (web). Metro prefers this `.native.tsx`.
 * See docs/react-native-tamagui-migration.md §1.5 / §7.
 */
export type PreProps = React.HTMLAttributes<HTMLPreElement>
export const Pre = React.forwardRef<any, PreProps>(({ children, ...props }, ref) => (
  <NativeText ref={ref} fontFamily="$mono" {...nativeSafeProps(props)}>
    {children}
  </NativeText>
))
Pre.displayName = 'Pre'

export type BrProps = React.HTMLAttributes<HTMLBRElement>
export const Br = React.forwardRef<any, BrProps>(() => null)
Br.displayName = 'Br'

export type HrProps = React.HTMLAttributes<HTMLHRElement>
export const Hr = React.forwardRef<any, HrProps>((props, ref) => (
  <NativeView ref={ref} height={1} backgroundColor="$border" {...nativeSafeProps(props)} />
))
Hr.displayName = 'Hr'

/** `<datalist>` has no RN analogue — the browser-only autocomplete source renders nothing. */
export type DataListProps = React.HTMLAttributes<HTMLDataListElement>
export const DataList = React.forwardRef<any, DataListProps>(() => null)
DataList.displayName = 'DataList'

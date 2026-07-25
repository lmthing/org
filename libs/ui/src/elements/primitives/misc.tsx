import * as React from 'react'
import { hostPrimitive } from './_host'

/**
 * Misc block passthrough primitives (Phase 0): `<pre>`, `<br>`, `<hr>`. Pure passthroughs.
 * Phase 1: `Pre` maps to a Tamagui monospace block, `Hr` to a themed `Separator`, `Br` to a
 * spacer/newline on native (§7).
 *
 * See docs/react-native-tamagui-migration.md §1.5.
 */
export type PreProps = React.HTMLAttributes<HTMLPreElement>
export const Pre = hostPrimitive<HTMLPreElement, PreProps>('pre', 'Pre')

export type BrProps = React.HTMLAttributes<HTMLBRElement>
export const Br = hostPrimitive<HTMLBRElement, BrProps>('br', 'Br')

export type HrProps = React.HTMLAttributes<HTMLHRElement>
export const Hr = hostPrimitive<HTMLHRElement, HrProps>('hr', 'Hr')

/**
 * `<datalist>` — a web-only autocomplete source with no RN analogue (the native fork renders
 * nothing). It exists as a primitive so the settings surfaces can stay raw-host-tag-free without
 * being split into `.web.tsx` files; it renders no visible box on either platform.
 */
export type DataListProps = React.HTMLAttributes<HTMLDataListElement>
export const DataList = hostPrimitive<HTMLDataListElement, DataListProps>('datalist', 'DataList')

import * as React from 'react'
// WEB primitives use the WEB config (empty theme → no theme-var injection; colors come from
// theme.css/Tailwind). The `*.native.tsx` forks use the colored `tamagui.config`. See tamagui-web.config.ts.
import { styled, View, Text as TamaguiText } from '../../theme/tamagui-web.config'

/**
 * Shared factory for the WEB Tamagui primitives (Phase-1 / Part III of the migration).
 *
 * These replace the Phase-0 passthrough wrappers. Each is a `forwardRef` around a `styled(View|Text)`
 * so the surfaces keep the SAME import + a superset of the same prop shape: the DOM props they always
 * passed (`className`, `onClick`, `children`, `style`, `id`, `role`, `data-*`, `aria-*`, `ref`) PLUS
 * the Tamagui layout props the B2 codemod lifts out of Tailwind classes (`alignItems`,
 * `justifyContent`, `flexGrow/Shrink/Basis`, `flexWrap`, `minWidth`, `alignSelf`, …). Tamagui splits
 * style props from DOM props internally, so we can spread everything onto the styled component.
 *
 * WEB block-compat resets (`flexShrink:1`, `minWidth/minHeight:'auto'`) make a `<Row>` compute like a
 * `<div class="flex">` and `<Col>` like `<div class="flex flex-col">` (proven byte-for-byte in
 * `tests/visual/equivalence.spec.ts` and the `apps/web/b0-probe` surface slice). The `*.native.tsx`
 * forks keep the RN defaults. See docs/react-native-tamagui-migration.md Part III (B1/B2).
 *
 * Typing note: the styled components are cast to `React.ComponentType<any>` on purpose — the repo
 * carries both `@types/react@18` (libs/ui) and `@types/react@19` (hoisted for react-native), whose
 * `ReactNode` unions differ, which makes Tamagui's richly-typed components unusable as JSX under a
 * bare `tsc`. The public prop TYPE below is hand-declared so surfaces get real prop-checking.
 */

/** The Tamagui layout style-props the codemod may lift onto a primitive (curated, web + native). */
export type LayoutStyleProps = {
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse'
  flex?: number
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number | string
  minWidth?: number | string
  minHeight?: number | string
  maxWidth?: number | string
  maxHeight?: number | string
  gap?: number | string
}

export type LayoutPrimitiveProps = React.HTMLAttributes<HTMLDivElement> & LayoutStyleProps

const webBlockCompat = { flexShrink: 1, minWidth: 'auto', minHeight: 'auto' } as const

/** Row — `styled(View,{flexDirection:'row'})` ≡ `<div class="flex">`. */
const RowStyled = styled(View, { name: 'Row', flexDirection: 'row', ...webBlockCompat }) as unknown as React.ComponentType<any>
/** Col — `styled(View,{flexDirection:'column'})` ≡ `<div class="flex flex-col">`. */
const ColStyled = styled(View, { name: 'Col', flexDirection: 'column', ...webBlockCompat }) as unknown as React.ComponentType<any>
/** Box — `styled(View,{display:'block'})` ≡ a block `<div>`. */
const BoxStyled = styled(View, { name: 'Box', display: 'block', ...webBlockCompat }) as unknown as React.ComponentType<any>

export const Row = React.forwardRef<HTMLDivElement, LayoutPrimitiveProps>((props, ref) =>
  React.createElement(RowStyled, { ...props, ref }),
)
Row.displayName = 'Row'

export const Col = React.forwardRef<HTMLDivElement, LayoutPrimitiveProps>((props, ref) =>
  React.createElement(ColStyled, { ...props, ref }),
)
Col.displayName = 'Col'

export { BoxStyled, TamaguiText }

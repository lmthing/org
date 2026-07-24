/**
 * Row — an explicit horizontal flex container, now a real Tamagui `styled(View)` (Part III / B2).
 *
 * Web output computes byte-for-byte like `<div class="flex">` (block-compat resets), proven in
 * `tests/visual/equivalence.spec.ts` + the `apps/web/b0-probe` surface slice. Accepts the surfaces'
 * DOM props (className/onClick/style/…) PLUS the Tamagui layout props the B2 codemod lifts out of
 * Tailwind classes (`alignItems`, `justifyContent`, `flexGrow/Shrink/Basis`, `flexWrap`, `minWidth`,
 * …). The `index.native.tsx` fork is the RN target. See docs/react-native-tamagui-migration.md.
 */
export { Row, type LayoutPrimitiveProps as RowProps } from '../_tamagui'

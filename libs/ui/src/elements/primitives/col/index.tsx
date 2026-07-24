/**
 * Col — an explicit vertical flex container, now a real Tamagui `styled(View)` (Part III / B2).
 *
 * Web output computes byte-for-byte like `<div class="flex flex-col">` (block-compat resets), proven
 * in `tests/visual/equivalence.spec.ts` + the `apps/web/b0-probe` surface slice. Accepts the surfaces'
 * DOM props PLUS the Tamagui layout props the B2 codemod lifts out of Tailwind classes. The
 * `index.native.tsx` fork is the RN target. See docs/react-native-tamagui-migration.md.
 */
export { Col, type LayoutPrimitiveProps as ColProps } from '../_tamagui'

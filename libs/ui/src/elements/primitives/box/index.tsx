/**
 * Box — the generic block container primitive, now a real Tamagui primitive (Part III / B3.3).
 *
 * Per-tag `createComponent` with **`isText: true`** (NOT `styled(View)`): a `.is_View` block Box would
 * inherit the `.is_View` font-family + line-height force (wrong for a plain `<div>`, which inherits
 * both), whereas `.is_Text` forces neither, so a block Box reproduces a plain div and the flex-child
 * classes (`shrink-*`/`min-*`/`items-*`) work as classes. Collisions lifted to props by the codemod
 * (`.is_Text`'s `margin:0`; inline-Tailwind display/whitespace); the design system's own `@apply`
 * display utilities were made `!important` so BEM boxes keep their display. Renders `<div>` by default;
 * `as` selects a block semantic tag. Proven ≡ a raw block `<div>` (incl. `font-mono`/`text-*` boxes) in
 * `apps/web/b0-probe/box-variants.mjs`. The `index.native.tsx` fork is the RN target.
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4 / Part III B3.3.
 */
export { Box, type BoxPrimitiveProps as BoxProps, type BoxAs } from '../_tamagui'

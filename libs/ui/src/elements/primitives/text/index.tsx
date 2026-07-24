/**
 * Text — the generic inline / body-text primitive, now a real Tamagui `styled(Text)` (Part III / B3.1).
 *
 * Web output computes byte-for-byte like a plain host tag across every `as` variant + the text-flow
 * conflict classes, proven in `apps/web/b0-probe/text-variants.mjs` (21/21). Renders `<span>` by
 * default; `block` → `<p>`; `as` selects any inline text tag (`strong`/`em`/`small`/`label`/`kbd`/…)
 * or a heading (`h1`–`h6`). Absorbs the inline-text + heading tags across the surfaces. Accepts the
 * surfaces' DOM props (className/style/…) PLUS the text-flow style props the B3.1 codemod lifts out of
 * the Tailwind classes `.is_Text` fights (`display`, `whiteSpace`, `wordWrap`, `overflow`,
 * `textOverflow`). The `index.native.tsx` fork is the RN target. (Distinct from the styled
 * `typography/heading`, which adds `heading-*` classes.)
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4 / Part III B3.1.
 */
export { Text, type TextPrimitiveProps as TextProps, type TextAs } from '../_tamagui'

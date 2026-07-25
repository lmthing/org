/**
 * Image — the `<img>` primitive. A real Tamagui component built per-tag with `createComponent`
 * (see `_tamagui.tsx`), so the actual `<img>` and its replaced-content behaviour are
 * runtime-guaranteed AND it accepts style props.
 *
 * It was a pure host passthrough until the P3 codemod was found to be rewriting image classNames
 * (`h-5 w-5 object-cover`) into style props on it — which a host `<img>` treats as unknown DOM
 * attributes, silently dropping the styling. See docs/tamagui-idiomatic-migration.md §6.
 *
 * The `index.native.tsx` fork is the RN target.
 */
export { Image, type ImagePrimitiveProps as ImageProps } from '../_tamagui'

/**
 * Pressable — the clickable primitive, now a real Tamagui primitive (Part III / B3.2).
 *
 * Renders a real `<button>` (default) / `<a>` / `<div>` via per-tag `createComponent` (so the host
 * element is runtime-guaranteed — Tamagui's `tag` prop is compile-only), with `isText: true` so the
 * `.is_Text` base leaves font/line-height alone (a button carries `text-sm`; the `.is_View` base would
 * force them — the B2 collision). Web output computes like a plain (preflight-reset) button/anchor,
 * proven ≡ raw tags (tag NAME + computed style) in `apps/web/b0-probe/pressable-variants.mjs`. Accepts
 * the surfaces' DOM props (className/onClick/disabled/href/…) PLUS the `display`/text-flow style props
 * the codemod / wrapper components lift out of the Tailwind display classes `.is_Text` fights. The
 * `index.native.tsx` fork is the RN target (maps `onPress`).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4 / Part III B3.2.
 */
export { Pressable, type PressablePrimitiveProps as PressableProps, type PressableAs } from '../_tamagui'

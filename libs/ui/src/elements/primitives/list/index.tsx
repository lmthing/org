/**
 * List / ListItem — the `<ul>`/`<ol>`/`<li>` primitives, now real Tamagui primitives (Part III /
 * B3.4-leaf). Per-tag `createComponent` (`isText`; List → display block, ListItem → display list-item).
 * `.is_Text` sets no list-style, so `list-disc`/`list-decimal`/`ml-*` classes work (margins lifted).
 * `ordered` renders `<ol>`. The `index.native.tsx` fork renders RN Views. See docs §1.5 / §4.
 */
export { List, type ListProps, ListItem, type ListItemProps } from '../_tamagui'

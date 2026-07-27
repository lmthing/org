/**
 * The `DROPDOWN_*` values both targets share — platform-free by construction (pure data).
 *
 * Same reason as `../dialog/styles.ts`: both forks carried a full copy of each bag, so every token,
 * radius and spacing value existed twice with nothing keeping them in step. The deltas that are
 * real stay in the forks — native drops `color` (an RN `View` does not inherit it into its text
 * children, so it would style nothing) and swaps hover for press, because a touch device has no
 * hover.
 */

/** `.dropdown__content` — the popover panel. Web adds `color: '$popover-foreground'`. */
export const DROPDOWN_CONTENT_SHARED = {
  position: 'absolute',
  zIndex: 50,
  // `width: auto` on an absolutely-positioned box shrink-wraps to the *containing*
  // block (the trigger's own box, per `DROPDOWN_ROOT`'s `display: inline-block`)
  // when neither `left` nor `right` is set — not to the menu's own content. An
  // icon-only trigger is narrower than its menu, so items clipped silently. Web's
  // first real consumer (the team surface) caught this; `width: max-content`
  // sizes the panel to its own content instead, with `minWidth` as the floor.
  width: 'max-content',
  minWidth: '$32',
  overflow: 'hidden',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$popover',
  padding: '$1',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 4 },
  shadowRadius: 6,
} as const

/**
 * `.dropdown__item` — the layout core. Web adds the pointer affordances (`cursor`, `userSelect`,
 * `outline*`), typography (`fontSize`, `color`) and `hoverStyle`; native adds `pressStyle`.
 */
export const DROPDOWN_ITEM_SHARED = {
  alignItems: 'center',
  gap: '$2',
  borderRadius: '$radius-sm',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
} as const

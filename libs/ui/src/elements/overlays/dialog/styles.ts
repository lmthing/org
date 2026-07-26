/**
 * The `DIALOG_*` values both targets share — platform-free by construction (pure data, no import
 * of anything that resolves differently on web and native).
 *
 * `index.tsx` and `index.native.tsx` each exported their own copy of all four bags. The values that
 * genuinely differ are few and specific (RN has no `position: fixed`, no `display: grid`, and
 * centres with flex rather than a `translate(-50%, -50%)` trick) — everything else was a duplicated
 * literal that nothing kept in step. A token change, a radius change or a shadow change landed on
 * one copy and not the other, silently and forever, because no test compares the two files.
 *
 * So the shared core lives here once and each fork spreads it and states its own delta. The forks
 * still EXPORT the same names — that is the fork mechanism working: a surface writes
 * `{...DIALOG_BASE}` once and Metro hands it the right one.
 */

/** The scrim behind the panel. `position` is the fork's to set: `fixed` on web, `absolute` on RN. */
export const DIALOG_BACKDROP_SHARED = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 50,
  backgroundColor: '$scrim',
} as const

/**
 * The panel itself, minus positioning. Web pins it with `fixed` + a 50%/50% translate; native lets
 * the Modal's viewport centre it with flex, so it carries no positioning at all.
 */
export const DIALOG_PANEL_SHARED = {
  width: '100%',
  maxWidth: 512, // max-w-lg = 32rem (no size token)
  backgroundColor: '$background',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  padding: '$6',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 10 },
  shadowRadius: 15,
} as const

/** `.dialog__content` — web adds `display: 'grid'`; a native view is already a flex column. */
export const DIALOG_CONTENT_SHARED = { gap: '$4' } as const

/** `.dialog__header` — web adds `display: 'flex'`; native views are flex already. */
export const DIALOG_HEADER_SHARED = { flexDirection: 'column', gap: '$2' } as const

import { styled, View } from '@tamagui/core'
import './tamagui.config'

/**
 * B0 probe styled components. Each sets a box-model property that a Tailwind class
 * on the same element will try to override. The computed value tells us who wins.
 */

// Tamagui says align-items: stretch; className "items-center" says center.
export const AlignBox = styled(View, {
  name: 'AlignBox',
  alignItems: 'stretch',
})

// Tamagui base is flex-direction: column; className "flex-row" says row.
export const DirBox = styled(View, {
  name: 'DirBox',
})

// Tamagui says justify-content: flex-start; className "justify-end" says flex-end.
export const JustifyBox = styled(View, {
  name: 'JustifyBox',
  justifyContent: 'flex-start',
})

// Tamagui says display: flex (View default); className "hidden" (display:none) — extreme test.
export const DisplayBox = styled(View, {
  name: 'DisplayBox',
})

// ── B2 migration-rule candidates ────────────────────────────────────────────────────────────
// The real Row/Col will be exactly these (web block-compat resets). Used by the ref-vs-candidate
// layout proof to verify which Tailwind classes survive on a Tamagui primitive (keep as className)
// and which must move to Tamagui props (because .is_View sets them unlayered).
const webBlockCompat = { flexShrink: 1, minWidth: 'auto', minHeight: 'auto' } as const
export const Row = styled(View, { name: 'Row', flexDirection: 'row', ...webBlockCompat })
export const Col = styled(View, { name: 'Col', flexDirection: 'column', ...webBlockCompat })

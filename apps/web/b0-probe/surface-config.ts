import { createTamagui, styled, View } from '@tamagui/core'

/**
 * Minimal, non-colliding Tamagui config for the SURFACE migration proof.
 *
 * The candidate mounts real theme.css (which defines --background/--foreground/…). This config's
 * theme keys are deliberately named so Tamagui injects NOTHING that collides with those vars — the
 * candidate's Row/Col carry only LAYOUT (no theme colors); all colors come from the kept Tailwind
 * classes resolving against theme.css, identical to the reference. (Same isolation rationale as
 * tests/visual/harness/eq-tamagui.config.ts.)
 */
export const surfaceConfig = createTamagui({
  themes: { light: { sfInk: '#000', sfBg: '#fff' } },
  tokens: {
    color: { sfInk: '#000', sfBg: '#fff' },
    radius: { 0: 0, true: 0 },
    space: { 0: 0, true: 0 },
    size: { 0: 0, true: 0 },
    zIndex: { 0: 0, true: 0 },
  },
  fonts: { body: { family: 'system-ui', size: { 4: 14, true: 14 }, lineHeight: { 4: 20, true: 20 } } },
  settings: { allowedStyleValues: 'somewhat-strict' },
})

const webBlockCompat = { flexShrink: 1, minWidth: 'auto', minHeight: 'auto' } as const

/** The real Row/Col will be exactly these. */
export const Row = styled(View, { name: 'Row', flexDirection: 'row', ...webBlockCompat })
export const Col = styled(View, { name: 'Col', flexDirection: 'column', ...webBlockCompat })

export default surfaceConfig

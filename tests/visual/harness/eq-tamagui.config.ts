import { createTamagui } from '@tamagui/core'

/**
 * Minimal, harness-LOCAL Tamagui config for the B1 equivalence proof only.
 *
 * The equivalence fixtures test the Tamagui `styled(View)` BOX MODEL (the `.is_View` RN base + the
 * web block-compat resets), which is config-independent — themes carry only colors/tokens, not the
 * View base. We deliberately do NOT import the real `libs/ui` `tamagui.config` here: its themes
 * inject CSS custom properties named `--background`/`--color`/… (from the same tokens.json), which
 * would collide with the harness's own `--background`/`--foreground` vars and override them in dark
 * mode, corrupting the passthrough baselines. The real config's theme VALUES are already proven
 * byte-equal to theme.css by the Layer-1 token-parity tests; this proof only needs a valid config
 * so `styled()`/`TamaguiProvider` run. Theme keys are intentionally non-colliding.
 */
export const eqConfig = createTamagui({
  themes: { light: { eqColor: '#000000', eqBg: '#ffffff' } },
  tokens: {
    color: { eqColor: '#000000', eqBg: '#ffffff' },
    radius: { 0: 0, true: 0 },
    space: { 0: 0, 1: 4, 2: 8, true: 0 },
    size: { 0: 0, 1: 4, 2: 8, true: 0 },
    zIndex: { 0: 0, true: 0 },
  },
  fonts: {
    body: { family: 'system-ui', size: { 4: 14, true: 14 }, lineHeight: { 4: 20, true: 20 } },
  },
  settings: { allowedStyleValues: 'somewhat-strict' },
})

export default eqConfig

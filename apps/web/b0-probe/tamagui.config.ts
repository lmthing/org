import { createTamagui } from '@tamagui/core'

// Minimal config for the B0 probe — enough for createTamagui + styled() to run.
export const config = createTamagui({
  themes: { light: { background: '#ffffff', color: '#000000' } },
  tokens: {
    color: { background: '#ffffff', color: '#000000' },
    radius: { 0: 0, true: 0 },
    space: { 0: 0, 1: 4, 2: 8, 4: 16, true: 0 },
    size: { 0: 0, 1: 4, 2: 8, 4: 16, true: 0 },
    zIndex: { 0: 0, true: 0 },
  },
  fonts: {
    body: { family: 'system-ui', size: { 4: 14, true: 14 }, lineHeight: { 4: 20, true: 20 } },
  },
  settings: { allowedStyleValues: 'somewhat-strict' },
})

type Conf = typeof config
declare module '@tamagui/core' {
  interface TamaguiCustomConfig extends Conf {}
}

export default config

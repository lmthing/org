/**
 * The app's bundled font faces.
 *
 * Native does NOT understand a CSS font stack. `--font-sans` is `"Manrope, system-ui, sans-serif"`,
 * and React Native takes that entire string as ONE family name, fails to find it, and silently falls
 * back to the platform default. Before this file existed the mobile app loaded no fonts at all — no
 * `expo-font`, no assets — so every screen rendered in Roboto/SF while web rendered the design
 * system's face. Nothing failed and no gate could see it.
 *
 * The keys here are the family names Tamagui asks for, so they must stay in lockstep with
 * `libs/ui/src/theme/tamagui.config.ts#NATIVE_FACE` — that map is what turns a `fontWeight` into one
 * of these names, because Android will not synthesise a weight from a single registered face.
 *
 * Assets come from the design system (`libs/css/assets/fonts`), NOT from a copy in this app, so the
 * wordmark cannot drift between targets. Metro resolves the relative path because `metro.config.js`
 * watches the `sdk/org` workspace root.
 */
export const FONT_ASSETS = {
  // Body + display. Weight ramp matches the `fontWeights` token scale that components actually use.
  Manrope: require('../../../libs/css/assets/fonts/Manrope-Regular.ttf'),
  'Manrope-Medium': require('../../../libs/css/assets/fonts/Manrope-Medium.ttf'),
  'Manrope-SemiBold': require('../../../libs/css/assets/fonts/Manrope-SemiBold.ttf'),
  'Manrope-Bold': require('../../../libs/css/assets/fonts/Manrope-Bold.ttf'),
  'Manrope-ExtraBold': require('../../../libs/css/assets/fonts/Manrope-ExtraBold.ttf'),

  // The wordmark face — `$brand` only, never body text.
  'TypeMates Cera Round Pro Bold': require('../../../libs/css/assets/fonts/cera-round-pro-bold.otf'),

  // Code / monospace.
  'JetBrains Mono': require('../../../libs/css/assets/fonts/JetBrainsMono-Regular.ttf'),
  'JetBrains Mono-Medium': require('../../../libs/css/assets/fonts/JetBrainsMono-Medium.ttf'),
} as const

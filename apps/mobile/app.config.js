// Expo config. A .js file rather than app.json so that every colour in it is READ
// from the design tokens instead of transcribed as a hex literal — `tokens.json` is
// the source of truth for the web surfaces this app shares, and an adaptive-icon
// background or a splash colour that drifts from it is the same class of bug as a
// raw colour in a stylesheet, just one no linter looks at.
//
// Regenerate the images these keys point at with `pnpm icons` after a token change.

const tokens = require('@lmthing/css/tokens.json')

function color(name, theme = 'light') {
  const token = tokens.colors.find((c) => c.name === name)
  if (!token) throw new Error(`app.config.js: unknown design token "${name}"`)
  return token[theme]
}

// `App.tsx` has a device-verification hatch that seeds an already-minted session from
// EXPO_PUBLIC_TEST_SESSION and skips the login screen entirely. babel-preset-expo
// INLINES every EXPO_PUBLIC_* var at build time, so a value present in the build
// environment ships inside the bundle — in a store build that is a published app with
// someone's real gateway session baked into it, and no login. Fail the build instead.
if (process.env.EAS_BUILD_PROFILE === 'production' && process.env.EXPO_PUBLIC_TEST_SESSION) {
  throw new Error(
    'EXPO_PUBLIC_TEST_SESSION is set for a production build. It bypasses the login ' +
      'screen and would be inlined into the shipped bundle. Unset it (and remove it ' +
      'from the EAS project secrets) before building for the store.',
  )
}

// The launcher icon is set on the DARK ground (see scripts/generate-icons.py), so the
// splash uses it in both themes as well. A light-mode splash would either flash a
// different colour than the icon that launched it, or put brand-1 yellow on a near
// white field, which is a 1.7:1 contrast ratio.
const MARK_GROUND = color('background', 'dark')

module.exports = {
  expo: {
    name: 'LMThing',
    slug: 'lmthing-mobile',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    scheme: 'lmthing',
    newArchEnabled: true,
    icon: './assets/icon.png',
    primaryColor: color('primary'),

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'org.lmthing.mobile',
    },

    android: {
      package: 'org.lmthing.mobile',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: MARK_GROUND,
      },
      // versionCode is deliberately absent: eas.json sets appVersionSource "remote",
      // so EAS owns the number and bumps it per build. Declaring it here as well means
      // two sources for the one value Play orders releases by.

      // Expo's prebuild template adds these three to the generated manifest, and this
      // app uses none of them: there is no file picker (attachments go through the
      // pod, not the gallery) and nothing draws over other apps. SYSTEM_ALERT_WINDOW
      // in particular surfaces to users on the listing as "Display over other apps",
      // which is a permission worth not asking for.
      blockedPermissions: [
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },

    plugins: [
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 180,
          resizeMode: 'contain',
          backgroundColor: MARK_GROUND,
          dark: { backgroundColor: MARK_GROUND },
        },
      ],
      [
        // Android throws away the colours of a status-bar icon and tints the alpha, so
        // this one is a white silhouette. Without it the shade shows a white square.
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: color('primary'),
        },
      ],
    ],

    extra: {
      eas: { projectId: 'deb721b3-6f38-4fcc-8aaa-4831845f1c7c' },
    },
  },
}

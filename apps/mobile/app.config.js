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

// The app's identity on the update server: the Application UUID from the eoas
// dashboard (control-plane mode), which is NOT the EAS projectId.
//
// It is compiled into the binary as a request header, so a store build made without it
// can never receive an update — the server answers "No app id provided" forever, and
// the fix is a new store release. That is the same failure as shipping without
// expo-updates at all, so a production build refuses rather than producing a binary
// whose OTA is quietly dead.
//
// Empty is fine for a local/dev build, which never asks the server for anything.
const OTA_APP_ID = process.env.EXPO_OTA_APP_ID ?? ''

if (process.env.EAS_BUILD_PROFILE === 'production' && !OTA_APP_ID) {
  throw new Error(
    'EXPO_OTA_APP_ID is unset. It is the Application UUID from the eoas dashboard ' +
      '(https://lmthing.cloud/ota/dashboard/), and it is baked into the binary — a ' +
      'store build without it can never receive an OTA update, and no config change ' +
      'fixes that afterwards. Set it in the production profile env in eas.json.',
  )
}

// The launcher icon is set on the DARK ground (see scripts/generate-icons.py), so the
// splash uses it in both themes as well. A light-mode splash would either flash a
// different colour than the icon that launched it, or put brand-1 yellow on a near
// white field, which is a 1.7:1 contrast ratio.
const MARK_GROUND = color('background', 'dark')

module.exports = {
  expo: {
    // Lowercase, matching the Play listing and the brand everywhere else — the favicon,
    // and `CozyThingText`, which renders the mark in lowercase and is the only place the
    // wordmark is defined (libs/ui/src/elements/branding/cozy-text). This is the label
    // under the launcher icon, so a capitalised one was the single surface saying
    // something different from the rest of the product.
    name: 'lmthing',
    // Must equal the slug of the EAS project named in `extra.eas.projectId` — EAS
    // refuses to build when the two disagree. This is the EXPO-side identifier only:
    // the Play listing is keyed on `android.package`, and expo-updates (the other
    // consumer of a slug) is disabled, so it names the project on expo.dev and
    // nothing else.
    slug: 'lmthing',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    scheme: 'lmthing',
    newArchEnabled: true,
    icon: './assets/icon.png',
    primaryColor: color('primary'),

    // Over-the-air updates, served by our own expo-open-ota rather than EAS Update.
    //
    // `url` is COMPILED INTO THE BINARY. Changing it later is a store release, not a
    // config edit.
    //
    // A path on the existing gateway host rather than an `updates.` subdomain: that
    // reuses the `cloud-https` listener, its certificate and its DNS, so standing the
    // update server up adds one HTTPRoute instead of a listener pair, a cert-manager
    // Certificate and a DNS record. Envoy strips the `/ota` prefix, and the server's
    // BASE_URL carries it so the asset URLs it hands out come back to the same place.
    updates: {
      url: 'https://lmthing.cloud/ota/manifest',
      enabled: true,
      // Launch from the cached bundle immediately and fetch in the background; the new
      // one starts next launch. The alternative blocks the splash on a network round
      // trip, which is the opposite of what the cold-wake work bought.
      fallbackToCacheTimeout: 0,
      // The PUBLIC half of the signing pair. Without this the client accepts any
      // manifest the URL returns, so anyone able to answer as that host — a hostile
      // DNS answer on a café network — executes code inside the app.
      codeSigningCertificate: './certs/certificate.pem',
      codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
      requestHeaders: {
        // RELEASE_CHANNEL, because that is the name the eoas CLI already uses for this
        // concept when it publishes. Two names for one value is how a build ends up
        // asking for a channel nothing was ever published to.
        'expo-channel-name': process.env.RELEASE_CHANNEL ?? 'production',
        // Which app on the update server this binary is. In control-plane mode this
        // is the Application UUID created in the eoas dashboard — NOT the EAS
        // projectId, and there is no fallback: without it the server answers every
        // manifest request "No app id provided".
        'expo-app-id': OTA_APP_ID,
      },
    },

    // An OTA can only ever replace JAVASCRIPT. `fingerprint` hashes the native project,
    // so adding a native module or bumping the SDK changes this automatically and old
    // binaries stop being offered a bundle they cannot run. The `appVersion` policy
    // relies on a human remembering to bump `version` in the same commit as a native
    // change; forgetting once means every installed copy launches a bundle whose native
    // modules are absent, which is a crash loop with no way out but a store release.
    runtimeVersion: { policy: 'fingerprint' },

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'org.lmthing.mobile',
    },

    android: {
      package: 'org.lmthing.mobile',
      // FCM's sender id and the package's API key, read at BUILD time and compiled in. Without it
      // `getExpoPushTokenAsync()` has no project to register the device against, takes the `catch`
      // in `src/push.ts#registerForPush`, and returns null — push looks "not implemented" rather
      // than unconfigured.
      //
      // Committed, on the same reasoning as `certs/certificate.pem`: it is the PUBLIC half. Every
      // value in it ships inside the APK and is readable from any installed copy, and it is not
      // what authorises SENDING — that is the service-account key EAS holds, which is not in this
      // repo. An EAS cloud build also needs the file present in the checkout.
      googleServicesFile: './google-services.json',
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

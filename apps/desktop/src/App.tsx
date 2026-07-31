import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { AuthProvider } from '@lmthing/auth'
import { tamaguiConfig } from '@lmthing/ui/theme/tamagui.config'
import { applyTheme } from '@lmthing/ui/chat'
import { OfflineBanner } from './OfflineBanner'
import { AuthGate } from './AuthGate'

/**
 * Root of the LMThing desktop app.
 *
 * Deliberately as thin as `apps/mobile/App.tsx`, and for the same reason: every screen lives in
 * `@lmthing/ui` where all three targets render it from one source. A screen written HERE would be a
 * fork of the product wearing an import path, which no gate could see — `scripts/lint-barrel-imports.mjs`
 * exists to make that hard to do by accident.
 *
 * What this shell genuinely owns is the provider, the boot order (`main.tsx`), and the window-level
 * chrome the shared surfaces cannot know about. It owns no product.
 *
 * The RN-isms of the mobile shell have no analogue here and are simply absent: there is no
 * `SafeAreaView` (a window has no notch), no `KeyboardAvoidingView` (a desktop keyboard does not
 * cover the app), and no `StatusBar`.
 */
export function App() {
  const scheme = usePreferredColorScheme()

  // Light/dark is a CSS concern here, not a Tamagui one — `theme.css` keys every colour off
  // `data-theme` on `<html>`, and `applyTheme` is what sets it. See the provider note below.
  React.useEffect(() => {
    applyTheme(scheme)
  }, [scheme])

  return (
    // `defaultTheme="app"`, and NOT the light/dark name this used to pass.
    //
    // On the WEB target — which a Tauri webview is — the Tamagui config has exactly one theme,
    // named `app`, and it is empty on purpose so `theme.css` keeps full control of colour
    // (`@lmthing/ui/theme/tamagui.config`). `light` and `dark` are the NATIVE pair; naming one here
    // means Tamagui finds no theme at all.
    //
    // That mistake was invisible in a production build and fatal in dev. Tamagui's complaint lives
    // behind `NODE_ENV === 'development'`, so a built app rendered unthemed and every E2E passed
    // (they assert text and roles, never colour) — while `pnpm tauri:dev` formatted that same
    // complaint with `JSON.stringify(props)`, hit React's internal cycle, threw out of module
    // evaluation, and left a totally black window with nothing in any log.
    <TamaguiProvider config={tamaguiConfig} defaultTheme="app">
      {/* A property of the machine, not of whichever surface is open — as relevant on the login
          screen (you cannot sign in offline) and the pod-boot screen (that IS a network call) as
          once a conversation is open, so it sits above everything rather than inside `HomeShell`. */}
      <OfflineBanner />
      <AuthProvider appName="desktop">
        <AuthGate />
      </AuthProvider>
    </TamaguiProvider>
  )
}

/**
 * The OS light/dark preference, live.
 *
 * `matchMedia` rather than mobile's `useColorScheme()`: the RN hook does not exist here, and this
 * is the browser primitive it wraps. Tauri also emits its own window theme event, but the media
 * query is what the renderer already answers with and needs no bridge round trip.
 */
function usePreferredColorScheme(): 'light' | 'dark' {
  const query = React.useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), [])
  const [dark, setDark] = React.useState(() => query.matches)

  React.useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [query])

  return dark ? 'dark' : 'light'
}

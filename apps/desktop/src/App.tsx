import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { AuthProvider } from '@lmthing/auth'
import { tamaguiConfig } from '@lmthing/ui/theme/tamagui.config'
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

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
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

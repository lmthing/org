import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '@lmthing/ui/theme/tamagui-web.config'
import { AuthProvider } from '@lmthing/auth'
import { PinGate } from '@lmthing/ui/components/auth/pin-gate'
import { AuthGate } from '@/lib/gates'
import '@/index.css'

/**
 * Shared root for the unified web app. Auth + pin are common to all three
 * surfaces (studio / computer / chat), so they live here once. Each surface's
 * own providers (PodEnsureGate, AppProvider, ComputerProvider, …) live in its
 * layout route (`studio/route.tsx`, `computer/route.tsx`). `@lmthing/auth`
 * stores the session under a constant key, so one appName unifies the session
 * across surfaces.
 */
function RootComponent() {
  return (
    // Empty-theme TamaguiProvider: gives the Tamagui layout primitives (Row/Col/…) their required
    // theme context while injecting NO color vars, so theme.css keeps full control of theming
    // (data-theme + space `--lm-*` overrides). See @lmthing/ui/theme/tamagui-web.config.
    <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
      <AuthProvider appName="studio">
        <AuthGate>
          <PinGate>
            <Outlet />
          </PinGate>
        </AuthGate>
      </AuthProvider>
    </TamaguiProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})

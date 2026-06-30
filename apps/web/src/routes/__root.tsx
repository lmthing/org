import { createRootRoute, Outlet } from '@tanstack/react-router'
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
    <AuthProvider appName="studio">
      <AuthGate>
        <PinGate>
          <Outlet />
        </PinGate>
      </AuthGate>
    </AuthProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})

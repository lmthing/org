import * as React from 'react'
import { useAuth } from '@lmthing/auth'
import { LoginScreen } from '@lmthing/ui/components/auth/login-screen'
import { ensureComputePod, waitForPodEdge } from '@lmthing/ui/lib/pod-boot'
import * as Prim from '@lmthing/ui/elements/primitives'
import { HomeShell } from './HomeShell'

type PodState = 'pending' | 'ready' | 'error'

/**
 * Not a screen of its own — sequences the two things that must be true before any surface makes its
 * first pod fetch: signed in, and the pod's own edge actually serving.
 *
 * The sequencing logic itself is `@lmthing/ui/lib/pod-boot`, shared with `apps/mobile` (and the
 * half of `apps/web/src/lib/gates.tsx` that is not web-specific). This file is only the states a
 * person sees while it runs — which is the entire divergence budget for pod boot.
 */
export function AuthGate() {
  const { isAuthenticated, isLoading, getAccessToken } = useAuth()
  const [pod, setPod] = React.useState<PodState>('pending')
  const [error, setError] = React.useState<string | null>(null)
  // Bumped by Retry. Without it in the dep list a failed boot — a bad network, the 120s cold-wake
  // timeout, a 5xx — lands on static text with no way back short of quitting the app.
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    setPod('pending')
    setError(null)
    void (async () => {
      try {
        await ensureComputePod(getAccessToken)
        await waitForPodEdge(getAccessToken)
        if (!cancelled) setPod('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setPod('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getAccessToken, attempt])

  if (isLoading) return null
  if (!isAuthenticated) return <LoginScreen />

  if (pod === 'error') {
    return (
      <Prim.Col alignItems="center" justifyContent="center" flex={1} padding="$4" gap="$3">
        <Prim.Text textAlign="center">{error ?? 'Could not start your workspace.'}</Prim.Text>
        <Prim.Pressable
          onClick={() => setAttempt((n) => n + 1)}
          minHeight="$10"
          paddingHorizontal="$5"
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="$radius-lg"
          backgroundColor="$muted"
          aria-label="Retry"
        >
          <Prim.Text color="$primary" fontWeight="$semibold">
            Retry
          </Prim.Text>
        </Prim.Pressable>
      </Prim.Col>
    )
  }

  if (pod !== 'ready') {
    return (
      <Prim.Col alignItems="center" justifyContent="center" flex={1} gap="$3">
        {/* A cold wake can take much of the 120s `waitForPodEdge` budget. Bare text alone reads as
            a hang, with no way to tell "still working" from "frozen". */}
        <Prim.Text>Starting your workspace…</Prim.Text>
      </Prim.Col>
    )
  }

  return <HomeShell />
}

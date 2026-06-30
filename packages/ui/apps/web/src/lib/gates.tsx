import { useEffect, useRef, useState } from 'react'
import { useAuth, isPodEmbedded, isLocalRun } from '@lmthing/auth'
import { LoginScreen } from '@lmthing/ui/components/auth/login-screen'
import { CLOUD_BASE_URL } from '@/lib/config'

export const centerStyles: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  color: '#6b7280',
  flexDirection: 'column',
  gap: 12,
}

/** Block rendering until auth has resolved; show login when not authenticated. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) return <LoginScreen />
  return <>{children}</>
}

/** Ensure the user's compute pod is running before any pod API call. */
async function ensurePod(
  cloudBaseUrl: string,
  getAccessToken: () => Promise<string>,
): Promise<void> {
  const token = await getAccessToken()
  const res = await fetch(`${cloudBaseUrl}/api/compute/ensure`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`compute/ensure failed: ${res.status}`)
  }
}

/**
 * Generic pod-readiness gate shared by the studio and computer surfaces. On an
 * authenticated session it POSTs {CLOUD_BASE_URL}/api/compute/ensure (Bearer
 * JWT), renders a "Starting compute pod…" state (+ Retry on failure), and only
 * renders children once ensure resolves. Pod-embedded (iframe) runs skip the
 * fetch and render children immediately.
 */
export function PodEnsureGate({ children }: { children: React.ReactNode }) {
  // Pod-embedded (token injected) or local run (the pod is the server itself):
  // no need to ensure the pod via the cloud gateway.
  if (isPodEmbedded() || isLocalRun()) return <>{children}</>
  const { session, getAccessToken } = useAuth()
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)
  const initRef = useRef(false)

  useEffect(() => {
    if (!session?.accessToken || initRef.current) return
    initRef.current = true

    let cancelled = false
    async function init() {
      try {
        await ensurePod(CLOUD_BASE_URL, getAccessToken)
        if (!cancelled) setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        }
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [session, getAccessToken])

  const handleRetry = () => {
    initRef.current = false
    setError(null)
    setStatus('pending')
  }

  if (!session) {
    return <div style={centerStyles}>Signing in…</div>
  }

  if (status === 'error') {
    return (
      <div style={centerStyles}>
        <p style={{ color: '#c00' }}>Failed to start compute pod: {error}</p>
        <button onClick={handleRetry}>Retry</button>
      </div>
    )
  }

  if (status === 'pending') {
    return <div style={centerStyles}>Starting compute pod…</div>
  }

  return <>{children}</>
}

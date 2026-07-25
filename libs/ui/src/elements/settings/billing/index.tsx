import * as Prim from '../../primitives/index.js';
import { useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { Button } from '../../forms/button'
import { Caption } from '../../typography/caption'
import { dataPlaneOrigin } from '../../../lib/app-urls'

async function openBillingPortal(
  authFetch: (url: string, options?: RequestInit) => Promise<Response>,
  cloud: string,
) {
  const res = await authFetch(`${cloud}/api/billing/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ return_url: window.location.href }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? 'Failed to open billing portal')
  }
  const { portal_url } = await res.json()
  window.location.href = portal_url
}

/** Billing section content (no heading/card): opens the Stripe customer portal. */
export function Billing() {
  const { authFetch, isAuthenticated } = useAuth()
  const CLOUD = dataPlaneOrigin('cloud')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBillingPortal = async () => {
    setLoading(true)
    setError(null)
    try {
      await openBillingPortal(authFetch, CLOUD)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal')
      setLoading(false)
    }
  }

  if (!isAuthenticated) {
    return <Caption muted>Sign in with your cloud account to manage billing.</Caption>
  }

  return (
    <Prim.Box style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Button variant="outline" size="sm" onClick={handleBillingPortal} disabled={loading}>
        {loading ? 'Redirecting…' : 'Manage Subscription'}
      </Button>
      {error && <Caption className="text-destructive">{error}</Caption>}
    </Prim.Box>
  )
}

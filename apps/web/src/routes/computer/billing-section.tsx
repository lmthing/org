import { useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { Card, CardHeader, CardBody } from '@lmthing/ui/elements/content/card'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { CLOUD_BASE_URL } from '@/lib/config'

async function openBillingPortal(authFetch: (url: string, options?: RequestInit) => Promise<Response>) {
  const res = await authFetch(`${CLOUD_BASE_URL}/api/billing/portal`, {
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

/** Billing card for the Settings page: opens the Stripe customer portal. */
export function BillingSection() {
  const { authFetch, isAuthenticated } = useAuth()
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)

  const handleBillingPortal = async () => {
    setBillingLoading(true)
    setBillingError(null)
    try {
      await openBillingPortal(authFetch)
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to open billing portal')
      setBillingLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <Heading level={4}>Billing</Heading>
      </CardHeader>
      <CardBody>
        {!isAuthenticated && (
          <Caption muted>
            Sign in with your cloud account to manage billing.
          </Caption>
        )}
        {isAuthenticated && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleBillingPortal}
            disabled={billingLoading}
          >
            {billingLoading ? 'Redirecting...' : 'Manage Subscription'}
          </Button>
        )}
        {billingError && (
          <Caption className="text-destructive">{billingError}</Caption>
        )}
      </CardBody>
    </Card>
  )
}

import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import { useAuth } from '@lmthing/auth'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Separator } from '@lmthing/ui/elements/content/separator'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@lmthing/ui/elements/overlays/dialog'
import { Trash2 } from 'lucide-react'
import { STRIPE_PUBLISHABLE_KEY } from '@/lib/config'
import { teamApi, type TeamBillingUsage } from '@/lib/team-api'
import { useTeamAuth } from '@/lib/team-auth'

/**
 * Team settings: the name, the team's own credentials, billing/usage, and — for
 * an editor — deleting the team outright.
 *
 * The credentials are the team's, never a member's — this is where a team's
 * Slack/GitHub/Google tokens live, on the team's pod. Saving REPLACES the whole
 * set and rolls the pod for everyone, so the editor is a full-text view of it
 * and the warning says so plainly.
 */

/** Mirrors `cloud/gateway/src/lib/tiers.ts` (and `com/src/config/plans.ts`'s
 * display copy) — tier metadata isn't served by any endpoint, so every surface
 * that shows an upgrade option keeps its own small copy, by this repo's own
 * convention (see `org/docs/contributing/add-a-tier.md`). */
const UPGRADE_TIERS = [
  { id: 'basic', name: 'Basic', price: '$10/mo' },
  { id: 'pro', name: 'Pro', price: '$20/mo' },
  { id: 'max', name: 'Max', price: '$100/mo' },
] as const

const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null

function SettingsPage() {
  const { teamId } = useParams({ from: '/team/$teamId' })
  const { authFetch } = useAuth()
  const navigate = useNavigate()
  const team = useTeamAuth()
  const isEditor = team.role === 'editor'

  const [name, setName] = useState('')
  const [envText, setEnvText] = useState('')
  const [usage, setUsage] = useState<TeamBillingUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkoutTier, setCheckoutTier] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const detail = await teamApi.get(authFetch, teamId)
      setName(detail.name)
      if (detail.role === 'editor') {
        const { vars } = await teamApi.getEnv(authFetch, teamId)
        setEnvText(
          Object.entries(vars)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n'),
        )
      }
      setUsage(await teamApi.getBillingUsage(authFetch, teamId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [authFetch, teamId])

  useEffect(() => {
    void load()
  }, [load])

  const saveName = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await teamApi.rename(authFetch, teamId, trimmed)
      setNotice('Name saved.')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveEnv = async () => {
    setBusy(true)
    try {
      const vars: Record<string, string> = {}
      for (const line of envText.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) throw new Error(`Not a KEY=VALUE line: ${trimmed}`)
        vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
      }
      await teamApi.setEnv(authFetch, teamId, vars)
      setNotice('Credentials saved — the team workspace is restarting.')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const deleteTeam = async () => {
    setBusy(true)
    try {
      await teamApi.deleteTeam(authFetch, teamId)
      await navigate({ to: '/team' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Prim.Box padding="$6" maxWidth={720} overflow="auto" height="100%">
      <Heading level={1} marginBottom="$4">
        Settings
      </Heading>

      {error ? (
        <Caption color="$destructive" marginBottom="$3">
          {error}
        </Caption>
      ) : null}
      {notice ? <Caption marginBottom="$3">{notice}</Caption> : null}

      <Prim.Box marginBottom="$6">
        <Heading level={4} marginBottom="$2">
          Name
        </Heading>
        <Prim.Row gap="$2">
          <Input value={name} onChange={(e) => setName(e.target.value)} flex={1} disabled={!isEditor} />
          {isEditor ? (
            <Button onClick={() => void saveName()} disabled={busy}>
              Save
            </Button>
          ) : null}
        </Prim.Row>
      </Prim.Box>

      <Prim.Box marginBottom="$6">
        <Separator />
      </Prim.Box>

      <Prim.Box marginBottom="$6">
        <Heading level={4} marginBottom="$2">
          Billing
        </Heading>
        {usage ? (
          <Prim.Col gap="$3">
            <Prim.Row alignItems="center" gap="$2">
              <Badge variant="primary">{usage.tier}</Badge>
              <Caption>${usage.spend.toFixed(2)} spent</Caption>
            </Prim.Row>
            <Prim.Col gap="$2">
              {usage.budgets.map((b) => {
                const pct = b.max_budget > 0 ? Math.min(100, (b.spend / b.max_budget) * 100) : 0
                return (
                  <Prim.Box key={b.duration}>
                    <Prim.Row justifyContent="space-between" marginBottom="$1">
                      <Caption>{b.duration} window</Caption>
                      <Caption>
                        ${b.spend.toFixed(2)} / ${b.max_budget.toFixed(2)}
                      </Caption>
                    </Prim.Row>
                    <Prim.Box backgroundColor="$muted" borderRadius="$radius-full" height="$1.5" overflow="hidden">
                      <Prim.Box backgroundColor="$primary" height="100%" width={`${pct}%`} />
                    </Prim.Box>
                  </Prim.Box>
                )
              })}
            </Prim.Col>
            {isEditor ? (
              <Prim.Row gap="$2" marginTop="$1" flexWrap="wrap">
                {UPGRADE_TIERS.filter((t) => t.id !== usage.tier).map((t) => (
                  <Button key={t.id} variant="outline" size="sm" onClick={() => setCheckoutTier(t.id)}>
                    Upgrade to {t.name} — {t.price}
                  </Button>
                ))}
              </Prim.Row>
            ) : null}
          </Prim.Col>
        ) : (
          <Caption>Loading…</Caption>
        )}
      </Prim.Box>

      <Prim.Box marginBottom="$6">
        <Separator />
      </Prim.Box>

      {isEditor ? (
        <Prim.Box marginBottom="$6">
          <Heading level={4} marginBottom="$1">
            Credentials
          </Heading>
          <Caption marginBottom="$2">
            The team's own provider tokens, one KEY=VALUE per line. These belong to the team, not to
            you. Saving replaces the whole set and restarts the team workspace for everyone.
          </Caption>
          <Textarea value={envText} onChange={(e) => setEnvText(e.target.value)} rows={12} width="100%" />
          <Button onClick={() => void saveEnv()} disabled={busy} marginTop="$2">
            Save credentials
          </Button>
        </Prim.Box>
      ) : (
        <Caption marginBottom="$6">Only an editor can see or change the team's credentials.</Caption>
      )}

      {isEditor ? (
        <>
          <Prim.Box marginBottom="$6">
        <Separator />
      </Prim.Box>
          <Prim.Box>
            <Heading level={4} marginBottom="$1" color="$destructive">
              Danger zone
            </Heading>
            <Caption marginBottom="$2">
              Deleting a team removes its pod, its channels, and its billing history. This cannot be
              undone.
            </Caption>
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 size={14} aria-hidden={true} />
                  Delete team
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle asChild>
                    <Heading level={3}>Delete "{name}"?</Heading>
                  </DialogTitle>
                  <DialogDescription asChild>
                    <Caption>
                      This permanently deletes the team's pod, channels, projects, and billing
                      history. Members lose access immediately.
                    </Caption>
                  </DialogDescription>
                </DialogHeader>
                <Prim.Row gap="$2" justifyContent="flex-end" marginTop="$3">
                  <DialogClose asChild>
                    <Button variant="ghost" size="sm">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button variant="destructive" size="sm" onClick={() => void deleteTeam()} disabled={busy}>
                    Delete team
                  </Button>
                </Prim.Row>
              </DialogContent>
            </Dialog>
          </Prim.Box>
        </>
      ) : null}

      {checkoutTier ? (
        <Dialog open onOpenChange={(open) => !open && setCheckoutTier(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle asChild>
                <Heading level={3}>
                  Upgrade to {UPGRADE_TIERS.find((t) => t.id === checkoutTier)?.name}
                </Heading>
              </DialogTitle>
            </DialogHeader>
            {stripePromise ? (
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{
                  fetchClientSecret: async () => {
                    const { client_secret } = await teamApi.startCheckout(
                      authFetch,
                      teamId,
                      checkoutTier,
                      `${window.location.origin}/team/${teamId}/settings?session_id={CHECKOUT_SESSION_ID}`,
                    )
                    return client_secret
                  },
                }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            ) : (
              <Caption color="$destructive">
                Checkout isn't configured on this deployment yet (no Stripe publishable key).
              </Caption>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </Prim.Box>
  )
}

export const Route = createFileRoute('/team/$teamId/settings')({
  component: SettingsPage,
})

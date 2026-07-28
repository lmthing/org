import * as Prim from '@lmthing/ui/elements/primitives'
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
// `/pure`, not the package root: importing the root INJECTS `js.stripe.com/v3` into the document
// as a side effect of the import itself. Every route module is statically imported by
// `routeTree.gen.ts`, so that side effect ran on every page of the app — a phone opening a channel
// paid for a third-party script it would only ever need on the billing tab. The `/pure` entry loads
// the script when `loadStripe()` is actually called.
import { loadStripe } from '@stripe/stripe-js/pure'
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
import { createTeamClient } from '@lmthing/ui/team'
import { disablePush, enablePush, pushStatus, type PushStatus } from '@/lib/push'
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

/**
 * Notifications on this device.
 *
 * Per DEVICE, not per account, which is why it lives next to the profile rather
 * than in a team setting: a push subscription is a browser's, and turning it on
 * here says nothing about the member's phone.
 *
 * The permission prompt is fired only from the button. Asking on load is the
 * most reliable way to get a permanent block, and a blocked site cannot re-ask —
 * the only way back is through browser settings, which is why `denied` says so
 * instead of offering a button that would do nothing.
 */
function Notifications() {
  const { authFetch } = useAuth()
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void pushStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async () => {
    setBusy(true)
    try {
      setStatus(status?.enabled ? await disablePush(authFetch) : await enablePush(authFetch))
    } finally {
      setBusy(false)
    }
  }

  const explanation: Record<PushStatus['state'], string> = {
    unsupported: 'This browser cannot deliver notifications.',
    unconfigured: 'Notifications are not configured on this server yet.',
    denied: 'Blocked for this site. Re-allow it in your browser settings to turn them back on.',
    prompt: 'Get notified when somebody mentions you or sends a direct message — even with the app closed.',
    subscribed: 'On for this device. You will be notified for mentions and direct messages.',
  }

  return (
    <Prim.Box marginBottom="$6">
      <Heading level={4} marginBottom="$1">
        Notifications
      </Heading>
      <Caption>{status ? explanation[status.state] : 'Checking…'}</Caption>
      {status && (status.state === 'prompt' || status.state === 'subscribed') ? (
        <Prim.Box marginTop="$3">
          <Button
            variant={status.enabled ? 'outline' : 'primary'}
            onClick={() => void toggle()}
            disabled={busy}
          >
            {status.enabled ? 'Turn off on this device' : 'Turn on notifications'}
          </Button>
        </Prim.Box>
      ) : null}
    </Prim.Box>
  )
}

/**
 * What you are called in this team, and the `@handle` colleagues type to reach
 * you.
 *
 * First on the page, and open to a viewer as well as an editor, because it is
 * the one section here that is about the MEMBER rather than the team — a viewer
 * who cannot be addressed cannot really be talked to, and everything below this
 * is configuration they are only reading.
 *
 * It talks to the team's POD (`/api/team/profile`), not the gateway: a handle is
 * per-team, so the same person is `@ana` in one team and `@ana.k` in another,
 * and the gateway's membership row has no business holding it.
 */
function YourProfile({ team }: { team: ReturnType<typeof useTeamAuth> }) {
  const client = useMemo(
    () => createTeamClient({ baseUrl: '', getToken: team.getTeamToken }),
    [team],
  )
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { profile } = await client.profile()
        if (cancelled) return
        setHandle(profile?.handle ?? '')
        setDisplayName(profile?.displayName ?? '')
      } catch {
        /* an unreachable pod is already reported by the surrounding page */
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client])

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await client.setProfile({ handle: handle.trim() || null, displayName: displayName.trim() || null })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Prim.Box marginBottom="$6">
      <Heading level={4} marginBottom="$1">
        Your profile
      </Heading>
      <Caption>How you appear in this team, and the handle colleagues type to reach you.</Caption>
      {/* Two fields and a button across a 390px phone leave each field about 130px wide, which is
          narrower than the words they are asking for. Stacked below `md`, side by side above it —
          base styles ARE the phone styles here, the `$md` block is the desktop override. */}
      <Prim.Box
        display="flex"
        flexDirection="column"
        gap="$2"
        marginTop="$3"
        $md={{ flexDirection: 'row', alignItems: 'flex-start' }}
      >
        <Prim.Col flex={1} gap="$1">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
            disabled={!loaded}
          />
        </Prim.Col>
        <Prim.Col flex={1} gap="$1">
          <Input
            value={handle}
            onChange={(e) => setHandle(e.target.value.replace(/^@+/, '').toLowerCase())}
            placeholder="handle"
            disabled={!loaded}
          />
          <Caption>{handle ? `Mentioned as @${handle}` : 'Without one, nobody can @-mention you.'}</Caption>
        </Prim.Col>
        <Button onClick={() => void save()} disabled={busy || !loaded}>
          Save
        </Button>
      </Prim.Box>
      {error ? (
        <Caption color="$destructive" marginTop="$2">
          {error}
        </Caption>
      ) : null}
      {saved && !error ? <Caption marginTop="$2">Saved.</Caption> : null}
    </Prim.Box>
  )
}

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

      <YourProfile team={team} />

      <Prim.Box marginBottom="$6">
        <Separator />
      </Prim.Box>

      <Notifications />

      <Prim.Box marginBottom="$6">
        <Separator />
      </Prim.Box>

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
                // LiteLLM doesn't always have a per-window spend figure yet — `spend`
                // can be `null` even though `max_budget` is always set.
                const spend = b.spend ?? 0
                const pct = b.max_budget > 0 ? Math.min(100, (spend / b.max_budget) * 100) : 0
                return (
                  <Prim.Box key={b.duration}>
                    <Prim.Row justifyContent="space-between" marginBottom="$1">
                      <Caption>{b.duration} window</Caption>
                      <Caption>
                        {b.spend === null ? '—' : `$${spend.toFixed(2)}`} / ${b.max_budget.toFixed(2)}
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

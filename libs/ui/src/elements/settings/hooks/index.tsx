import * as Prim from '../../primitives/index.js';
import * as React from 'react'
import { useAuth } from '@lmthing/auth'
import { Badge, type BadgeVariant } from '../../content/badge'
import { Button } from '../../forms/button'
import { Caption } from '../../typography/caption'
import { Code } from '../../typography/code'
import { dataPlaneOrigin } from '../../../lib/app-urls'

interface HookSummary {
  projectId: string
  slug: string
  owner: string
  type: string
  on?: string
  every?: string
  daily?: string
  path?: string
  provider?: string
  trigger?: string
  hasHandler: boolean
  disabled: boolean
}

/** The type groups, in display order. Anything else falls into 'other'. */
const TYPE_GROUPS: Array<{ type: string; label: string }> = [
  { type: 'cron', label: 'Cron' },
  { type: 'event', label: 'Event' },
  { type: 'webhook', label: 'Webhook' },
  { type: 'other', label: 'Other' },
]

function typeVariant(type: string): BadgeVariant {
  if (type === 'cron') return 'primary'
  if (type === 'event') return 'success'
  return 'muted'
}

/** A one-line human summary of what triggers the hook. */
function scheduleOf(h: HookSummary): string {
  if (h.type === 'cron') return h.every ? `every ${h.every}` : h.daily ? `daily at ${h.daily}` : 'cron'
  if (h.type === 'event') return h.on ? `on ${h.on}` : 'event'
  if (h.type === 'webhook') return `POST /${h.path}${h.provider && h.provider !== 'generic' ? ` (${h.provider})` : ''}`
  return h.type
}

/**
 * Hooks section content: the pod-global list of every automated hook (cron /
 * event / webhook) across all projects and installed spaces, grouped by type,
 * each with an enable/disable toggle. Disabling records the slug in the project's
 * hook-state overlay (no source rewrite) so the runtime stops scheduling it.
 */
export function Hooks() {
  const { authFetch, isAuthenticated } = useAuth()
  const COMPUTER = dataPlaneOrigin('computer')

  const [hooks, setHooks] = React.useState<HookSummary[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    authFetch(`${COMPUTER}/api/hooks`)
      .then((r) => r.json())
      .then((d: { hooks?: HookSummary[] }) => {
        if (cancelled) return
        setHooks(Array.isArray(d.hooks) ? d.hooks : [])
      })
      .catch(() => { if (!cancelled) setError('Failed to load hooks') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authFetch, isAuthenticated, COMPUTER])

  const rowKey = (h: HookSummary) => `${h.projectId}/${h.slug}`

  const toggle = async (h: HookSummary) => {
    const key = rowKey(h)
    const next = !h.disabled
    setBusy((b) => new Set(b).add(key))
    // Optimistic update.
    setHooks((cur) => cur?.map((x) => (rowKey(x) === key ? { ...x, disabled: next } : x)) ?? cur)
    try {
      const r = await authFetch(
        `${COMPUTER}/api/projects/${encodeURIComponent(h.projectId)}/hooks/${encodeURIComponent(h.slug)}/disabled`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled: next }) },
      )
      if (!r.ok) throw new Error(String(r.status))
    } catch {
      // Roll back on failure.
      setHooks((cur) => cur?.map((x) => (rowKey(x) === key ? { ...x, disabled: !next } : x)) ?? cur)
      setError('Failed to update hook')
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(key); return n })
    }
  }

  const groupsWithHooks = TYPE_GROUPS.map((g) => ({
    ...g,
    rows: (hooks ?? []).filter((h) =>
      g.type === 'other' ? !['cron', 'event', 'webhook'].includes(h.type) : h.type === g.type,
    ),
  })).filter((g) => g.rows.length > 0)

  return (
    <Prim.Box display="flex" flexDirection="column" gap="0.75rem">
      <Caption muted>
        Automated hooks running on your pod — scheduled (cron), event-driven, and
        inbound webhooks — across every project and installed space. Toggle one off
        to stop it firing without deleting it.
      </Caption>

      {loading ? (
        <Caption muted>Loading…</Caption>
      ) : !isAuthenticated ? (
        <Caption muted>Log in to view hooks.</Caption>
      ) : !hooks || hooks.length === 0 ? (
        <Caption muted>No automated hooks found.</Caption>
      ) : (
        groupsWithHooks.map((g) => (
          <Prim.Box key={g.type} display="flex" flexDirection="column" gap="0.25rem">
            <Prim.Box display="flex" alignItems="center" gap="0.5rem" marginTop="0.25rem">
              <Badge variant={typeVariant(g.type)}>{g.label}</Badge>
              <Caption muted>{g.rows.length}</Caption>
            </Prim.Box>
            {g.rows.map((h) => {
              const key = rowKey(h)
              return (
                <Prim.Box
                  key={key}
                  display="flex" alignItems="center" gap="0.5rem" paddingVertical="0.5rem" paddingHorizontal="0" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--border)" opacity={h.disabled ? 0.55 : 1}
                >
                  <Prim.Box display="flex" flexDirection="column" gap="0.2rem" flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
                    <Prim.Box display="flex" alignItems="center" gap="0.5rem" flexWrap="wrap">
                      <Code>{h.slug}</Code>
                      <Badge variant="muted">{h.projectId}</Badge>
                      {h.owner && h.owner !== 'project' && <Badge variant="muted">{h.owner}</Badge>}
                    </Prim.Box>
                    <Prim.Box display="flex" alignItems="center" gap="0.5rem" flexWrap="wrap">
                      <Caption muted>{scheduleOf(h)}</Caption>
                      <Caption muted>→ {h.trigger ?? (h.hasHandler ? 'handler' : '—')}</Caption>
                    </Prim.Box>
                  </Prim.Box>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy.has(key)}
                    onClick={() => toggle(h)}
                    style={{ flexShrink: 0 }}
                  >
                    {h.disabled ? 'Enable' : 'Disable'}
                  </Button>
                </Prim.Box>
              )
            })}
          </Prim.Box>
        ))
      )}

      {error && <Caption color="$destructive">{error}</Caption>}
    </Prim.Box>
  )
}

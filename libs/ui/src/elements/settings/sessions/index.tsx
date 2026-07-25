import * as Prim from '../../primitives/index.js';
import * as React from 'react'
import { useAuth } from '@lmthing/auth'
import { Badge, type BadgeVariant } from '../../content/badge'
import { Caption } from '../../typography/caption'
import { Code } from '../../typography/code'
import { dataPlaneOrigin } from '../../../lib/app-urls'

interface DelegateEntry {
  target: string
  query?: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  model?: string
  durationMs: number
  status: 'running' | 'done' | 'error' | 'skipped'
  depth: number
  ts: number
}

interface SessionLedgerRecord {
  sessionId: string
  source: string
  projectId?: string
  title?: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'done' | 'error'
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  delegates: DelegateEntry[]
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtCost(usd: number): string {
  if (!usd) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Badge colour for a session's origin: chat = primary, hook = default, else muted. */
function sourceVariant(source: string): BadgeVariant {
  if (source === 'chat') return 'primary'
  if (source.startsWith('hook:')) return 'default'
  return 'muted'
}

function statusVariant(status: string): BadgeVariant {
  if (status === 'done') return 'success'
  if (status === 'error') return 'muted'
  return 'muted'
}

/**
 * Sessions section content: the pod-global ledger of every session (chat window
 * or a delegate inside a project hook), each with its total tokens and the
 * delegates it made (target, inputs, per-delegate tokens). Read-only.
 */
export function Sessions() {
  const { authFetch, isAuthenticated } = useAuth()
  const COMPUTER = dataPlaneOrigin('computer')

  const [sessions, setSessions] = React.useState<SessionLedgerRecord[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [expandedQuery, setExpandedQuery] = React.useState<Set<string>>(new Set())
  const now = React.useMemo(() => Date.now(), [sessions])

  React.useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    authFetch(`${COMPUTER}/api/session-ledger`)
      .then((r) => r.json())
      .then((d: { sessions?: SessionLedgerRecord[] }) => {
        if (cancelled) return
        setSessions(Array.isArray(d.sessions) ? d.sessions : [])
      })
      .catch(() => { if (!cancelled) setError('Failed to load sessions') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authFetch, isAuthenticated, COMPUTER])

  const toggle = (id: string, set: Set<string>, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    setter(next)
  }

  return (
    <Prim.Box display="flex" flexDirection="column" gap="0.5rem">
      <Caption muted>
        Every session your pod ran — from the chat window or a delegate inside a
        project hook — with its total token cost and the delegates it made.
      </Caption>

      {loading ? (
        <Caption muted>Loading…</Caption>
      ) : !isAuthenticated ? (
        <Caption muted>Log in to view sessions.</Caption>
      ) : !sessions || sessions.length === 0 ? (
        <Caption muted>No sessions recorded yet.</Caption>
      ) : (
        <Prim.Box display="flex" flexDirection="column" gap="0.25rem">
          {sessions.map((s) => {
            const open = expanded.has(s.sessionId)
            return (
              <Prim.Box
                key={s.sessionId}
                paddingVertical="0.5rem" paddingHorizontal="0" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--border)"
              >
                <Prim.Box
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(s.sessionId, expanded, setExpanded)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(s.sessionId, expanded, setExpanded) }}
                  display="flex" flexDirection="column" gap="0.35rem" cursor="pointer"
                >
                  <Prim.Box display="flex" alignItems="center" gap="0.5rem" flexWrap="wrap">
                    <Prim.Text color="var(--muted-foreground)" fontSize="0.75rem" width="0.75rem">
                      {open ? '▾' : '▸'}
                    </Prim.Text>
                    <Badge variant={sourceVariant(s.source)}>{s.source}</Badge>
                    {s.projectId && <Badge variant="muted">{s.projectId}</Badge>}
                    <Caption>{s.title ?? s.sessionId.slice(0, 8)}</Caption>
                    <Prim.Text marginLeft="auto">
                      <Caption muted>{relativeTime(s.startedAt, now)}</Caption>
                    </Prim.Text>
                  </Prim.Box>
                  <Prim.Box display="flex" alignItems="center" gap="0.75rem" paddingLeft="1.25rem" flexWrap="wrap">
                    <Caption muted>
                      {fmtInt(s.totalInputTokens)} in / {fmtInt(s.totalOutputTokens)} out
                    </Caption>
                    <Caption muted>{fmtCost(s.totalCostUsd)}</Caption>
                    <Caption muted>
                      {s.delegates.length} delegate{s.delegates.length === 1 ? '' : 's'}
                    </Caption>
                    {s.status !== 'done' && <Badge variant={statusVariant(s.status)}>{s.status}</Badge>}
                  </Prim.Box>
                </Prim.Box>

                {open && s.delegates.length > 0 && (
                  <Prim.Box display="flex" flexDirection="column" gap="0.4rem" paddingLeft="1.25rem" marginTop="0.5rem">
                    {s.delegates.map((d, i) => {
                      const key = `${s.sessionId}:${i}`
                      const qOpen = expandedQuery.has(key)
                      return (
                        <Prim.Box
                          key={key}
                          display="flex" flexDirection="column" gap="0.25rem" paddingVertical="0.4rem" paddingHorizontal="0.5rem" borderLeftWidth="2px" borderLeftStyle="solid" borderLeftColor="var(--border)" backgroundColor="var(--muted)" borderRadius="var(--radius, 0.375rem)"
                        >
                          <Prim.Box display="flex" alignItems="center" gap="0.5rem" flexWrap="wrap">
                            <Code>{d.target}</Code>
                            {d.depth > 0 && <Badge variant="muted">depth {d.depth}</Badge>}
                            {d.status !== 'done' && <Badge variant={statusVariant(d.status)}>{d.status}</Badge>}
                          </Prim.Box>
                          <Prim.Box display="flex" alignItems="center" gap="0.75rem" flexWrap="wrap">
                            <Caption muted>
                              {fmtInt(d.inputTokens)} in / {fmtInt(d.outputTokens)} out
                            </Caption>
                            <Caption muted>{fmtCost(d.costUsd)}</Caption>
                            <Caption muted>{fmtDuration(d.durationMs)}</Caption>
                            {d.model && <Caption muted>{d.model}</Caption>}
                          </Prim.Box>
                          {d.query && (
                            <Prim.Box>
                              <Prim.Pressable
                                onClick={() => toggle(key, expandedQuery, setExpandedQuery)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  color: 'var(--muted-foreground)',
                                  font: 'inherit',
                                  fontSize: '0.75rem',
                                }}
                              >
                                {qOpen ? 'Hide input' : 'Show input'}
                              </Prim.Pressable>
                              {qOpen && (
                                <Code style={{ display: 'block', whiteSpace: 'pre-wrap', marginTop: '0.25rem' }}>
                                  {d.query}
                                </Code>
                              )}
                            </Prim.Box>
                          )}
                        </Prim.Box>
                      )
                    })}
                  </Prim.Box>
                )}
              </Prim.Box>
            )
          })}
        </Prim.Box>
      )}

      {error && <Caption color="$destructive">{error}</Caption>}
    </Prim.Box>
  )
}

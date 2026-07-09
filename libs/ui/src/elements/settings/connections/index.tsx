import * as React from 'react'
import { useAuth } from '@lmthing/auth'
import { Button } from '../../forms/button'
import { Badge } from '../../content/badge'
import { Caption } from '../../typography/caption'
import { dataPlaneOrigin } from '../../../lib/app-urls'

interface Provider {
  id: string
  label: string
  /** The gateway has OAuth client creds for this provider. */
  configured: boolean
  /** This user has an active connection. */
  connected: boolean
  status?: string
  /** Granted scopes — the gateway sends a space/comma-delimited string; older
   *  shapes sent an array, so accept both and normalize at the render site. */
  scopes?: string | string[]
}

/** Normalize the provider `scopes` (string or array) into a display list. */
function scopeList(scopes?: string | string[]): string[] {
  if (Array.isArray(scopes)) return scopes
  if (typeof scopes === 'string') return scopes.split(/[\s,]+/).filter(Boolean)
  return []
}

/**
 * Connections section content (no heading/card): connect external services
 * (Google, Slack, GitHub, …) once via OAuth so any agent/space on the pod can
 * act on them. OAuth is brokered entirely by the gateway — tokens never enter
 * the browser or the pod. Mirrors the Workspace Backup connect/redirect flow.
 */
export function Connections() {
  const { authFetch, isAuthenticated } = useAuth()
  const CLOUD = dataPlaneOrigin('cloud')

  const [providers, setProviders] = React.useState<Provider[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    let cancelled = false
    setLoading(true)
    authFetch(`${CLOUD}/api/connections`)
      .then((r) => r.json())
      .then((d: { providers?: Provider[] }) => {
        if (cancelled) return
        setProviders(Array.isArray(d.providers) ? d.providers : [])
      })
      .catch(() => { if (!cancelled) setError('Failed to load connections') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authFetch, CLOUD])

  React.useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    return load()
  }, [isAuthenticated, load])

  const connect = async (id: string) => {
    setError(null); setNotice(null); setBusy(id)
    try {
      const res = await authFetch(
        `${CLOUD}/api/connections/${encodeURIComponent(id)}/connect` +
          `?redirect_to=${encodeURIComponent(window.location.href)}`,
      )
      const d = await res.json()
      if (!res.ok || !d.url) throw new Error(d.error ?? 'Failed to start connect')
      window.location.href = d.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setBusy(null)
    }
  }

  const disconnect = async (id: string) => {
    setError(null); setNotice(null); setBusy(id)
    try {
      const res = await authFetch(`${CLOUD}/api/connections/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed to disconnect')
      }
      setNotice('Disconnected.')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Caption muted>
        Connect external services once via OAuth so any agent on your pod can act on them.
        Access tokens stay in the gateway — they never reach your browser or your pod.
      </Caption>

      {loading ? (
        <Caption muted>Loading…</Caption>
      ) : !isAuthenticated ? (
        <Caption muted>Log in to manage connections.</Caption>
      ) : !providers || providers.length === 0 ? (
        <Caption muted>No connectable services are available on this server.</Caption>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {providers.map((p) => {
            const isBusy = busy === p.id
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Caption>{p.label}</Caption>
                    {p.connected ? (
                      <Badge variant="success">Connected</Badge>
                    ) : !p.configured ? (
                      <Badge variant="muted">Not configured</Badge>
                    ) : null}
                  </div>
                  {p.connected && p.status === 'error' ? (
                    <Caption className="text-destructive">
                      Reconnection needed — the last request failed.
                    </Caption>
                  ) : !p.configured ? (
                    <Caption muted>Not enabled on this server.</Caption>
                  ) : scopeList(p.scopes).length > 0 ? (
                    <Caption muted>{scopeList(p.scopes).join(', ')}</Caption>
                  ) : null}
                </div>

                {p.connected ? (
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {p.status === 'error' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => connect(p.id)}
                        disabled={isBusy}
                      >
                        {isBusy ? 'Reconnecting…' : 'Reconnect'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => disconnect(p.id)}
                      disabled={isBusy}
                    >
                      {isBusy ? 'Disconnecting…' : 'Disconnect'}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => connect(p.id)}
                    disabled={!p.configured || isBusy}
                    style={{ flexShrink: 0 }}
                  >
                    {isBusy ? 'Connecting…' : 'Connect'}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && <Caption className="text-destructive">{error}</Caption>}
      {notice && <Caption muted>{notice}</Caption>}
    </div>
  )
}

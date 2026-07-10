import { useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { Button } from '../../forms/button'
import { Input } from '../../forms/input'
import { Caption } from '../../typography/caption'
import { dataPlaneOrigin } from '../../../lib/app-urls'

interface ProviderField {
  key: string
  label: string
}

interface ProviderDef {
  id: string
  name: string
  guide: string
  fields: ProviderField[]
}

/**
 * Bring-your-own-token integrations. The user pastes their OWN provider tokens
 * (Slack, GitHub, Google, …), which are stored as env vars on their compute pod
 * and used directly by agents. Replaces the old gateway-brokered OAuth
 * "Connections" tab. Config lives on the gateway; saving triggers a pod restart.
 */
const PROVIDERS: ProviderDef[] = [
  {
    id: 'slack',
    name: 'Slack',
    guide:
      'Create a Slack app (api.slack.com/apps → From manifest), install it to your workspace, and invite the bot to a channel. Paste the Bot User OAuth Token and the app\'s Signing Secret. Then set the app\'s Event Subscriptions Request URL to your Slack trigger URL from the Triggers tab.',
    fields: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot token (xoxb-…)' },
      { key: 'SLACK_SIGNING_SECRET', label: 'Signing secret' },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    guide:
      'Create a fine-grained or classic PAT (repo scope) at github.com/settings/tokens. The webhook secret is only needed if you receive GitHub webhooks via the Triggers tab.',
    fields: [
      { key: 'GITHUB_TOKEN', label: 'Personal access token' },
      { key: 'GITHUB_WEBHOOK_SECRET', label: 'Webhook secret (optional)' },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    guide:
      'Paste a Google OAuth access token for the APIs you need (e.g. from the OAuth Playground). Note: Google access tokens are short-lived — you\'ll need to refresh it periodically.',
    fields: [{ key: 'GOOGLE_ACCESS_TOKEN', label: 'OAuth access token' }],
  },
]

const INTEGRATION_KEYS = PROVIDERS.flatMap(p => p.fields.map(f => f.key))

export function Integrations() {
  const { authFetch, isAuthenticated } = useAuth()
  const CLOUD = dataPlaneOrigin('cloud')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    let cancelled = false
    authFetch(`${CLOUD}/api/compute/env`)
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d.vars) return
        const cur = d.vars as Record<string, string>
        setFields(Object.fromEntries(INTEGRATION_KEYS.map(k => [k, cur[k] ?? ''])))
      })
      .catch(() => { if (!cancelled) setError('Failed to load integrations') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authFetch, isAuthenticated, CLOUD])

  const save = async () => {
    if (!isAuthenticated) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      // PUT replaces the whole var set — re-read the full set fresh and overlay
      // only the integration fields the user edited before saving.
      const cur = await authFetch(`${CLOUD}/api/compute/env`).then(r => r.json()).catch(() => ({ vars: {} }))
      const all = { ...((cur.vars ?? {}) as Record<string, string>) }
      for (const k of INTEGRATION_KEYS) all[k] = fields[k] ?? ''
      const res = await authFetch(`${CLOUD}/api/compute/env`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: all }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!isAuthenticated) return <Caption muted>Log in to manage integrations.</Caption>
  if (loading) return <Caption muted>Loading...</Caption>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {PROVIDERS.map(p => (
        <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Caption>{p.name}</Caption>
          <Caption muted>{p.guide}</Caption>
          {p.fields.map(f => (
            <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <Caption muted>{f.label}</Caption>
              <Input
                type="password"
                value={fields[f.key] ?? ''}
                onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                style={{ fontFamily: 'monospace' }}
              />
            </div>
          ))}
        </div>
      ))}
      {error && <Caption className="text-destructive">{error}</Caption>}
      {saved && <Caption muted>Saved. Pod is restarting to apply changes.</Caption>}
      <Button variant="primary" size="sm" onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save & Restart Pod'}
      </Button>
    </div>
  )
}

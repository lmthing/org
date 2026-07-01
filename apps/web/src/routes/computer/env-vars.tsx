import { useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { CLOUD_BASE_URL } from '@/lib/config'

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Env-vars editor for the compute pod's Settings page: load, add/remove/edit
 * key-value pairs, and save (which triggers a pod restart to apply changes).
 */
export function EnvVars() {
  const { authFetch, isAuthenticated } = useAuth()
  const [vars, setVars] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    let cancelled = false
    authFetch(`${CLOUD_BASE_URL}/api/compute/env`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.vars) setVars(d.vars) })
      .catch(() => { if (!cancelled) setError('Failed to load env vars') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authFetch, isAuthenticated])

  const addVar = () => {
    const k = newKey.trim()
    const v = newVal
    if (!k) return
    if (!KEY_RE.test(k)) { setError(`Invalid key "${k}"`); return }
    setVars(prev => ({ ...prev, [k]: v }))
    setNewKey('')
    setNewVal('')
    setError(null)
  }

  const removeVar = (key: string) => {
    setVars(prev => { const next = { ...prev }; delete next[key]; return next })
  }

  const save = async () => {
    if (!isAuthenticated) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await authFetch(`${CLOUD_BASE_URL}/api/compute/env`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars }),
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

  if (loading) return <Caption muted>Loading...</Caption>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {Object.entries(vars).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Input value={k} readOnly style={{ flex: '0 0 40%', fontFamily: 'monospace' }} />
          <Input
            value={v}
            onChange={e => setVars(prev => ({ ...prev, [k]: e.target.value }))}
            style={{ flex: 1, fontFamily: 'monospace' }}
          />
          <Button variant="ghost" size="sm" onClick={() => removeVar(k)}>Remove</Button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <Input
          placeholder="KEY"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          style={{ flex: '0 0 40%', fontFamily: 'monospace' }}
          onKeyDown={e => e.key === 'Enter' && addVar()}
        />
        <Input
          placeholder="value"
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          style={{ flex: 1, fontFamily: 'monospace' }}
          onKeyDown={e => e.key === 'Enter' && addVar()}
        />
        <Button variant="secondary" size="sm" onClick={addVar}>Add</Button>
      </div>
      {error && <Caption className="text-destructive">{error}</Caption>}
      {saved && <Caption muted>Saved. Pod is restarting to apply changes.</Caption>}
      <Button variant="primary" size="sm" onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save & Restart Pod'}
      </Button>
    </div>
  )
}

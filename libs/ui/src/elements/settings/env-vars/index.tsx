import * as Prim from '../../primitives/index.js';
import { useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { Button } from '../../forms/button'
import { Input } from '../../forms/input'
import { Caption } from '../../typography/caption'
import { dataPlaneOrigin } from '../../../lib/app-urls'
import { isModelKey } from '../models'

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Env-vars editor (no heading/card): load, add/remove/edit key-value pairs, and
 * save (which triggers a pod restart to apply changes). Config lives on the
 * gateway. Shared by the settings dialog and the computer settings page.
 */
export function EnvVars() {
  const { authFetch, isAuthenticated } = useAuth()
  const CLOUD = dataPlaneOrigin('cloud')
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
    authFetch(`${CLOUD}/api/compute/env`)
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d.vars) return
        // Model aliases (LM_MODEL*) are managed in the Models tab — hide them here.
        setVars(Object.fromEntries(
          Object.entries(d.vars as Record<string, string>).filter(([k]) => !isModelKey(k)),
        ))
      })
      .catch(() => { if (!cancelled) setError('Failed to load env vars') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authFetch, isAuthenticated, CLOUD])

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
      // Preserve model aliases (managed in the Models tab) — PUT replaces the
      // whole set, so re-read them fresh and merge before saving.
      const cur = await authFetch(`${CLOUD}/api/compute/env`).then(r => r.json()).catch(() => ({ vars: {} }))
      const modelVars = Object.fromEntries(
        Object.entries((cur.vars ?? {}) as Record<string, string>).filter(([k]) => isModelKey(k)),
      )
      const res = await authFetch(`${CLOUD}/api/compute/env`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: { ...modelVars, ...vars } }),
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

  if (!isAuthenticated) return <Caption muted>Log in to manage environment variables.</Caption>
  if (loading) return <Caption muted>Loading...</Caption>

  return (
    <Prim.Box display="flex" flexDirection="column" gap="0.5rem">
      {Object.entries(vars).map(([k, v]) => (
        <Prim.Box key={k} display="flex" flexWrap="wrap" gap="0.5rem" alignItems="center">
          <Input value={k} readOnly flexGrow={1} flexShrink={1} flexBasis="8rem" minWidth="6rem" fontFamily="monospace" />
          <Input
            value={v}
            onChange={e => setVars(prev => ({ ...prev, [k]: e.target.value }))}
            flexGrow={2} flexShrink={1} flexBasis="12rem" minWidth="10rem" fontFamily="monospace"
          />
          <Button variant="ghost" size="sm" onClick={() => removeVar(k)}>Remove</Button>
        </Prim.Box>
      ))}
      <Prim.Box display="flex" flexWrap="wrap" gap="0.5rem" alignItems="center">
        <Input
          placeholder="KEY"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          flexGrow={1} flexShrink={1} flexBasis="8rem" minWidth="6rem" fontFamily="monospace"
          onKeyDown={e => e.key === 'Enter' && addVar()}
        />
        <Input
          placeholder="value"
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          flexGrow={2} flexShrink={1} flexBasis="12rem" minWidth="10rem" fontFamily="monospace"
          onKeyDown={e => e.key === 'Enter' && addVar()}
        />
        <Button variant="outline" size="sm" onClick={addVar}>Add</Button>
      </Prim.Box>
      {error && <Caption color="$destructive">{error}</Caption>}
      {saved && <Caption muted>Saved. Pod is restarting to apply changes.</Caption>}
      <Button variant="primary" size="sm" onClick={save} disabled={saving}>
        {saving ? 'Saving...' : 'Save & Restart Pod'}
      </Button>
    </Prim.Box>
  )
}

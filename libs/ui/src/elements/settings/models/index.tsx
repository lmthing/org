import { useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { Button } from '../../forms/button'
import { Input } from '../../forms/input'
import { Select, SelectOption } from '../../forms/select'
import { Caption } from '../../typography/caption'
import { dataPlaneOrigin } from '../../../lib/app-urls'

/** True for env keys that define model aliases (managed here, not in Env Vars). */
export function isModelKey(key: string): boolean {
  return /^LM_MODEL(_|$)/.test(key)
}

/** Normalise an alias name into its env-key suffix (mirrors provider resolveAlias). */
function aliasKey(alias: string): string {
  return 'LM_MODEL_' + alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

interface AliasRow {
  /** Display alias (as referenced by `LM_MODEL`), e.g. `M`. */
  alias: string
  /** Full model spec, e.g. `azure:DeepSeek-V4-Flash`. */
  spec: string
}

function parseAliases(vars: Record<string, string>): AliasRow[] {
  return Object.entries(vars)
    .filter(([k]) => /^LM_MODEL_.+/.test(k))
    .map(([k, spec]) => ({ alias: k.replace(/^LM_MODEL_/, ''), spec }))
}

/**
 * Model-alias editor (no heading/card): map short aliases (e.g. `M`) to full
 * model specs (`azure:DeepSeek-V4-Flash`) and pick the default model. Aliases are
 * stored as `LM_MODEL_<ALIAS>` env vars and the default as `LM_MODEL`; the pod's
 * provider resolves them at runtime. Merges with the existing env on save so the
 * plain Env Vars are preserved.
 */
export function Models() {
  const { authFetch, isAuthenticated } = useAuth()
  const CLOUD = dataPlaneOrigin('cloud')
  const POD = dataPlaneOrigin('computer')

  const [rows, setRows] = useState<AliasRow[]>([])
  const [defaultAlias, setDefaultAlias] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    let cancelled = false
    Promise.all([
      authFetch(`${CLOUD}/api/compute/env`).then(r => r.json()).catch(() => ({ vars: {} })),
      authFetch(`${POD}/api/prices/azure`).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
    ])
      .then(([env, prices]: [{ vars?: Record<string, string> }, Record<string, unknown>]) => {
        if (cancelled) return
        const vars = env.vars ?? {}
        setRows(parseAliases(vars))
        setDefaultAlias(vars.LM_MODEL ?? '')
        setModels(Object.keys(prices).map(id => `azure:${id}`))
      })
      .catch(() => { if (!cancelled) setError('Failed to load models') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authFetch, isAuthenticated, CLOUD, POD])

  const setRow = (i: number, patch: Partial<AliasRow>) =>
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i))
  const addRow = () => setRows(prev => [...prev, { alias: '', spec: models[0] ?? '' }])

  const save = async () => {
    if (!isAuthenticated) return
    // Validate aliases are non-empty and unique.
    const seen = new Set<string>()
    for (const r of rows) {
      const a = r.alias.trim()
      if (!a) { setError('Every alias needs a name'); return }
      const key = aliasKey(a)
      if (seen.has(key)) { setError(`Duplicate alias "${a}"`); return }
      seen.add(key)
    }
    setSaving(true); setError(null); setSaved(false)
    try {
      // Merge with the current server env so non-model vars are preserved
      // (PUT replaces the whole set).
      const cur = await authFetch(`${CLOUD}/api/compute/env`).then(r => r.json()).catch(() => ({ vars: {} }))
      const preserved = Object.fromEntries(
        Object.entries((cur.vars ?? {}) as Record<string, string>).filter(([k]) => !isModelKey(k)),
      )
      const merged: Record<string, string> = { ...preserved }
      for (const r of rows) merged[aliasKey(r.alias)] = r.spec
      const def = defaultAlias.trim()
      if (def) merged.LM_MODEL = def
      const res = await authFetch(`${CLOUD}/api/compute/env`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: merged }),
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

  if (!isAuthenticated) return <Caption muted>Log in to manage model aliases.</Caption>
  if (loading) return <Caption muted>Loading…</Caption>

  const modelOptions = (current: string) => {
    const opts = models.includes(current) || !current ? models : [current, ...models]
    return opts
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <Caption muted>
        Aliases let you refer to a model by a short name (e.g. <code>M</code>) in agents and the
        CLI. The default is used when no model is specified.
      </Caption>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rows.length === 0 && <Caption muted>No aliases yet.</Caption>}
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Input
              value={r.alias}
              placeholder="alias"
              onChange={e => setRow(i, { alias: e.target.value })}
              style={{ flex: '0 0 25%', fontFamily: 'monospace' }}
            />
            <Select
              value={r.spec}
              onChange={e => setRow(i, { spec: e.target.value })}
              style={{ flex: 1 }}
            >
              {modelOptions(r.spec).map(m => (
                <SelectOption key={m} value={m}>{m}</SelectOption>
              ))}
            </Select>
            <Button variant="ghost" size="sm" onClick={() => removeRow(i)}>Remove</Button>
          </div>
        ))}
        <div>
          <Button variant="outline" size="sm" onClick={addRow}>Add alias</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <Caption muted>Default model</Caption>
        <Select
          value={defaultAlias}
          onChange={e => setDefaultAlias(e.target.value)}
          style={{ flex: 1, maxWidth: '16rem' }}
        >
          <SelectOption value="">— none —</SelectOption>
          {rows
            .map(r => r.alias.trim())
            .filter(Boolean)
            .map(a => (
              <SelectOption key={a} value={a}>{a}</SelectOption>
            ))}
        </Select>
      </div>

      {error && <Caption className="text-destructive">{error}</Caption>}
      {saved && <Caption muted>Saved. Pod is restarting to apply changes.</Caption>}
      <div>
        <Button variant="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Restart Pod'}
        </Button>
      </div>
    </div>
  )
}

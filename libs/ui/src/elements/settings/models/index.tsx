import { useEffect, useId, useState } from 'react'
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

/** The canonical size/tier aliases, with human labels (raw codes are hidden). */
const KNOWN_ALIASES: { code: string; label: string }[] = [
  { code: 'XS', label: 'Extra small' },
  { code: 'S', label: 'Small' },
  { code: 'M', label: 'Medium' },
  { code: 'L', label: 'Large' },
  { code: 'M_R', label: 'Medium (reasoning)' },
  { code: 'L_R', label: 'Large (reasoning)' },
]

/** Friendly label for an alias code, falling back to the code for custom ones. */
function labelFor(code: string): string {
  return KNOWN_ALIASES.find(a => a.code === code)?.label ?? code
}

/** Normalise an alias code into its env-key suffix (mirrors provider resolveAlias). */
function aliasKey(alias: string): string {
  return 'LM_MODEL_' + alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

interface AliasRow {
  /** Alias code (as referenced by `LM_MODEL`), e.g. `M` / `M_R`. */
  alias: string
  /** Full model spec, any string, e.g. `azure:gpt-5.5`. */
  spec: string
}

function parseAliases(vars: Record<string, string>): AliasRow[] {
  return Object.entries(vars)
    .filter(([k]) => /^LM_MODEL_.+/.test(k))
    .map(([k, spec]) => ({ alias: k.replace(/^LM_MODEL_/, ''), spec }))
}

/**
 * Model-alias editor (no heading/card): map size tiers (Extra small … Large,
 * plus reasoning variants) to any model spec (e.g. `azure:gpt-5.5`) and pick the
 * default. Aliases are stored as `LM_MODEL_<CODE>` env vars and the default as
 * `LM_MODEL`; the pod's provider resolves them at runtime. Merges with the
 * existing env on save so the plain Env Vars are preserved.
 */
export function Models() {
  const { authFetch, isAuthenticated } = useAuth()
  const CLOUD = dataPlaneOrigin('cloud')
  const POD = dataPlaneOrigin('computer')
  const listId = useId()

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
  const addRow = () => {
    const used = new Set(rows.map(r => r.alias))
    const next = KNOWN_ALIASES.find(a => !used.has(a.code))?.code ?? ''
    setRows(prev => [...prev, { alias: next, spec: '' }])
  }

  const save = async () => {
    if (!isAuthenticated) return
    // Validate aliases are non-empty and unique.
    const seen = new Set<string>()
    for (const r of rows) {
      const a = r.alias.trim()
      if (!a) { setError('Every row needs a size'); return }
      const key = aliasKey(a)
      if (seen.has(key)) { setError(`Duplicate size "${labelFor(a)}"`); return }
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

  if (!isAuthenticated) return <Caption muted>Log in to manage models.</Caption>
  if (loading) return <Caption muted>Loading…</Caption>

  // Each row's dropdown offers the known sizes plus its own value if custom.
  const aliasOptions = (current: string) =>
    KNOWN_ALIASES.some(a => a.code === current) || !current
      ? KNOWN_ALIASES
      : [{ code: current, label: current }, ...KNOWN_ALIASES]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <Caption muted>
        Pick which model powers each size tier. Agents and the CLI request a size (e.g. Medium) and
        the pod resolves it to the model you set here.
      </Caption>

      {models.length > 0 && (
        <datalist id={listId}>
          {models.map(m => <option key={m} value={m} />)}
        </datalist>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rows.length === 0 && <Caption muted>No models configured yet.</Caption>}
        {rows.map((r, i) => (
          <div
            key={i}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}
          >
            <Select
              value={r.alias}
              onChange={e => setRow(i, { alias: e.target.value })}
              style={{ flex: '1 1 9rem', minWidth: '8rem' }}
            >
              {aliasOptions(r.alias).map(a => (
                <SelectOption key={a.code} value={a.code}>{a.label}</SelectOption>
              ))}
            </Select>
            <Input
              value={r.spec}
              placeholder="azure:gpt-5.5"
              list={models.length > 0 ? listId : undefined}
              onChange={e => setRow(i, { spec: e.target.value })}
              style={{ flex: '2 1 16rem', minWidth: '12rem', fontFamily: 'monospace' }}
            />
            <Button variant="ghost" size="sm" onClick={() => removeRow(i)}>Remove</Button>
          </div>
        ))}
        <div>
          <Button variant="outline" size="sm" onClick={addRow}>Add model</Button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <Caption muted>Default size</Caption>
        <Select
          value={defaultAlias}
          onChange={e => setDefaultAlias(e.target.value)}
          style={{ flex: '1 1 12rem', minWidth: '10rem', maxWidth: '18rem' }}
        >
          <SelectOption value="">— none —</SelectOption>
          {rows
            .map(r => r.alias.trim())
            .filter(Boolean)
            .map(a => (
              <SelectOption key={a} value={a}>{labelFor(a)}</SelectOption>
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

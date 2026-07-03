import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Card } from '@lmthing/ui/elements/content/card'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Button } from '@lmthing/ui/elements/forms/button'
import {
  useAppApi,
  type AppManifest,
  type AppHook,
  type AppBuildStatus,
} from './-lib/appApi'

const SECTION: React.CSSProperties = { marginBottom: '1.5rem' }
const SUBTLE: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  opacity: 0.5,
  marginBottom: '0.5rem',
}
const MONO: React.CSSProperties = { fontFamily: 'monospace', fontSize: '0.8125rem' }

/** Colour a build/hook status word onto a Badge variant (design tokens only). */
function statusVariant(status?: string): 'default' | 'success' | 'muted' | 'primary' {
  const s = (status ?? '').toLowerCase()
  if (s === 'ok' || s === 'success' || s === 'built' || s === 'ready') return 'success'
  if (s === 'error' || s === 'failed') return 'default'
  if (s === 'building' || s === 'running' || s === 'pending') return 'primary'
  return 'muted'
}

function BuildCard({
  build,
  onRebuild,
  busy,
}: {
  build?: AppBuildStatus
  onRebuild: () => void
  busy: boolean
}) {
  const status = build?.status ?? (build?.ok === false ? 'error' : build?.ok ? 'ok' : 'unknown')
  return (
    <Card style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Heading level={4} style={{ margin: 0 }}>Build</Heading>
          <Badge variant={statusVariant(status)}>{status}</Badge>
        </div>
        {build?.error ? (
          <Caption style={{ color: 'var(--color-destructive)' }}>{build.error}</Caption>
        ) : build?.finishedAt ? (
          <Caption muted>Last built {formatTime(build.finishedAt)}</Caption>
        ) : (
          <Caption muted>No build recorded yet.</Caption>
        )}
      </div>
      <Button variant="outline" disabled={busy} onClick={onRebuild}>
        {busy ? 'Rebuilding…' : 'Rebuild'}
      </Button>
    </Card>
  )
}

function HookRow({
  hook,
  onRun,
  busy,
}: {
  hook: AppHook
  onRun: () => void
  busy: boolean
}) {
  const last = hook.lastRun
  return (
    <Card
      style={{
        padding: '0.75rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '0.5rem',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={MONO}>{hook.slug}</span>
          {hook.type ? <Badge variant="muted">{hook.type}</Badge> : null}
          {last?.status ? <Badge variant={statusVariant(last.status)}>{last.status}</Badge> : null}
        </div>
        <Caption muted>
          {hook.trigger ? <span style={MONO}>{hook.trigger}</span> : hook.description ?? '—'}
          {last?.at ? ` · last run ${formatTime(last.at)}` : ' · never run'}
          {last?.error ? ` · ${last.error}` : ''}
        </Caption>
      </div>
      <Button variant="outline" disabled={busy} onClick={onRun}>
        {busy ? 'Running…' : 'Run now'}
      </Button>
    </Card>
  )
}

function ManifestView() {
  const { projectId } = useParams({ from: '/studio/$projectId/app' })
  const api = useAppApi(projectId)

  const [manifest, setManifest] = useState<AppManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyHook, setBusyHook] = useState<string | null>(null)
  const [buildBusy, setBuildBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const m = await api.getManifest(signal)
        setManifest(m)
      } catch (e) {
        if (!signal?.aborted) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [api],
  )

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const runHook = useCallback(
    async (slug: string) => {
      setBusyHook(slug)
      setNotice(null)
      try {
        await api.runHook(slug)
        setNotice(`Hook "${slug}" triggered.`)
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyHook(null)
      }
    },
    [api, load],
  )

  const rebuild = useCallback(async () => {
    setBuildBusy(true)
    setNotice(null)
    try {
      await api.rebuild()
      setNotice('Rebuild triggered.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuildBusy(false)
    }
  }, [api, load])

  if (loading && !manifest) {
    return <Centered>Loading manifest…</Centered>
  }
  if (error && !manifest) {
    return <Centered destructive>Failed to load manifest: {error}</Centered>
  }
  if (manifest && manifest.hasApp === false) {
    return <Centered>This project has no app layer (spaces-only project).</Centered>
  }

  const m = manifest ?? {}
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '1.5rem' }}>
      {notice ? (
        <Caption style={{ display: 'block', marginBottom: '0.75rem', color: 'var(--color-accent)' }}>
          {notice}
        </Caption>
      ) : null}
      {error ? (
        <Caption style={{ display: 'block', marginBottom: '0.75rem', color: 'var(--color-destructive)' }}>
          {error}
        </Caption>
      ) : null}

      <div style={SECTION}>
        <BuildCard build={m.build} onRebuild={rebuild} busy={buildBusy} />
      </div>

      {/* Tables + column schema */}
      <div style={SECTION}>
        <div style={SUBTLE}>Tables ({m.tables?.length ?? 0})</div>
        {(m.tables ?? []).length === 0 ? (
          <Caption muted>No tables.</Caption>
        ) : (
          m.tables!.map((t) => (
            <Card key={t.name} style={{ padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={{ ...MONO, fontWeight: 600 }}>{t.name}</span>
                {t.title ? <Caption muted>{t.title}</Caption> : null}
              </div>
              {t.description ? <Caption muted>{t.description}</Caption> : null}
              {(t.columns ?? []).length > 0 ? (
                <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  {t.columns!.map((c) => (
                    <span
                      key={c.name}
                      title={c.description}
                      style={{
                        ...MONO,
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: 'var(--color-muted)',
                      }}
                    >
                      {c.name}
                      <span style={{ opacity: 0.6 }}>
                        :{c.type ?? 'string'}
                        {c.primaryKey ? ' pk' : ''}
                        {c.required ? ' req' : ''}
                        {c.unique ? ' uniq' : ''}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          ))
        )}
      </div>

      {/* Pages */}
      <div style={SECTION}>
        <div style={SUBTLE}>Pages ({m.pages?.length ?? 0})</div>
        {(m.pages ?? []).length === 0 ? (
          <Caption muted>No pages.</Caption>
        ) : (
          <Card style={{ padding: '0.5rem 1rem' }}>
            {m.pages!.map((p) => (
              <div key={p.route} style={{ ...MONO, padding: '0.25rem 0' }}>
                {p.route}
                {p.path ? <span style={{ opacity: 0.5 }}> — {p.path}</span> : null}
              </div>
            ))}
          </Card>
        )}
      </div>

      {/* Endpoints */}
      <div style={SECTION}>
        <div style={SUBTLE}>Endpoints ({m.endpoints?.length ?? 0})</div>
        {(m.endpoints ?? []).length === 0 ? (
          <Caption muted>No endpoints.</Caption>
        ) : (
          m.endpoints!.map((e) => (
            <Card
              key={`${e.method} ${e.name}`}
              style={{ padding: '0.5rem 1rem', marginBottom: '0.375rem' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Badge variant="primary">{e.method}</Badge>
                <span style={{ ...MONO, fontWeight: 600 }}>{e.name}</span>
                {e.route ? (
                  <Caption muted>
                    <span style={MONO}>{e.route}</span>
                  </Caption>
                ) : null}
              </div>
              {e.description ? <Caption muted>{e.description}</Caption> : null}
              {e.input || e.output ? (
                <Caption muted>
                  <span style={MONO}>
                    {e.input ? `in: ${e.input}` : ''}
                    {e.input && e.output ? '  ' : ''}
                    {e.output ? `out: ${e.output}` : ''}
                  </span>
                </Caption>
              ) : null}
            </Card>
          ))
        )}
      </div>

      {/* Hooks */}
      <div style={SECTION}>
        <div style={SUBTLE}>Hooks ({m.hooks?.length ?? 0})</div>
        {(m.hooks ?? []).length === 0 ? (
          <Caption muted>No hooks.</Caption>
        ) : (
          m.hooks!.map((h) => (
            <HookRow
              key={h.slug}
              hook={h}
              busy={busyHook === h.slug}
              onRun={() => runHook(h.slug)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function Centered({ children, destructive }: { children: React.ReactNode; destructive?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '2rem',
        textAlign: 'center',
        opacity: destructive ? 1 : 0.6,
        color: destructive ? 'var(--color-destructive)' : 'inherit',
        fontSize: '0.875rem',
      }}
    >
      {children}
    </div>
  )
}

function formatTime(t: number | string): string {
  const d = typeof t === 'number' ? new Date(t) : new Date(t)
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString()
}

export const Route = createFileRoute('/studio/$projectId/app/')({
  component: ManifestView,
})

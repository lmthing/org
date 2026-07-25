import * as Prim from '@lmthing/ui/elements/primitives';
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
    <Card padding="1rem" display="flex" alignItems="center" gap="1rem">
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%">
        <Prim.Box display="flex" alignItems="center" gap="0.5rem">
          <Heading level={4} margin={0}>Build</Heading>
          <Badge variant={statusVariant(status)}>{status}</Badge>
        </Prim.Box>
        {build?.error ? (
          <Caption color="var(--color-destructive)">{build.error}</Caption>
        ) : build?.finishedAt ? (
          <Caption muted>Last built {formatTime(build.finishedAt)}</Caption>
        ) : (
          <Caption muted>No build recorded yet.</Caption>
        )}
      </Prim.Box>
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
      paddingVertical="0.75rem" paddingHorizontal="1rem" display="flex" alignItems="center" gap="1rem" marginBottom="0.5rem"
    >
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
        <Prim.Box display="flex" alignItems="center" gap="0.5rem">
          <Prim.Text style={MONO}>{hook.slug}</Prim.Text>
          {hook.type ? <Badge variant="muted">{hook.type}</Badge> : null}
          {last?.status ? <Badge variant={statusVariant(last.status)}>{last.status}</Badge> : null}
        </Prim.Box>
        <Caption muted>
          {hook.trigger ? <Prim.Text style={MONO}>{hook.trigger}</Prim.Text> : hook.description ?? '—'}
          {last?.at ? ` · last run ${formatTime(last.at)}` : ' · never run'}
          {last?.error ? ` · ${last.error}` : ''}
        </Caption>
      </Prim.Box>
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
    <Prim.Box height="100%" overflow="auto" padding="1.5rem">
      {notice ? (
        <Caption display="block" marginBottom="0.75rem" color="var(--color-accent)">
          {notice}
        </Caption>
      ) : null}
      {error ? (
        <Caption display="block" marginBottom="0.75rem" color="var(--color-destructive)">
          {error}
        </Caption>
      ) : null}

      <Prim.Box style={SECTION}>
        <BuildCard build={m.build} onRebuild={rebuild} busy={buildBusy} />
      </Prim.Box>

      {/* Tables + column schema */}
      <Prim.Box style={SECTION}>
        <Prim.Box style={SUBTLE}>Tables ({m.tables?.length ?? 0})</Prim.Box>
        {(m.tables ?? []).length === 0 ? (
          <Caption muted>No tables.</Caption>
        ) : (
          m.tables!.map((t) => (
            <Card key={t.name} paddingVertical="0.75rem" paddingHorizontal="1rem" marginBottom="0.5rem">
              <Prim.Box display="flex" alignItems="baseline" gap="0.5rem">
                <Prim.Text style={{ ...MONO, fontWeight: 600 }}>{t.name}</Prim.Text>
                {t.title ? <Caption muted>{t.title}</Caption> : null}
              </Prim.Box>
              {t.description ? <Caption muted>{t.description}</Caption> : null}
              {(t.columns ?? []).length > 0 ? (
                <Prim.Box marginTop="0.5rem" display="flex" flexWrap="wrap" gap="0.375rem">
                  {t.columns!.map((c) => (
                    <Prim.Text
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
                      <Prim.Text opacity={0.6}>
                        :{c.type ?? 'string'}
                        {c.primaryKey ? ' pk' : ''}
                        {c.required ? ' req' : ''}
                        {c.unique ? ' uniq' : ''}
                      </Prim.Text>
                    </Prim.Text>
                  ))}
                </Prim.Box>
              ) : null}
            </Card>
          ))
        )}
      </Prim.Box>

      {/* Pages */}
      <Prim.Box style={SECTION}>
        <Prim.Box style={SUBTLE}>Pages ({m.pages?.length ?? 0})</Prim.Box>
        {(m.pages ?? []).length === 0 ? (
          <Caption muted>No pages.</Caption>
        ) : (
          <Card paddingVertical="0.5rem" paddingHorizontal="1rem">
            {m.pages!.map((p) => (
              <Prim.Box key={p.route} style={{ ...MONO, padding: '0.25rem 0' }}>
                {p.route}
                {p.path ? <Prim.Text opacity={0.5}> — {p.path}</Prim.Text> : null}
              </Prim.Box>
            ))}
          </Card>
        )}
      </Prim.Box>

      {/* Endpoints */}
      <Prim.Box style={SECTION}>
        <Prim.Box style={SUBTLE}>Endpoints ({m.endpoints?.length ?? 0})</Prim.Box>
        {(m.endpoints ?? []).length === 0 ? (
          <Caption muted>No endpoints.</Caption>
        ) : (
          m.endpoints!.map((e) => (
            <Card
              key={`${e.method} ${e.name}`}
              paddingVertical="0.5rem" paddingHorizontal="1rem" marginBottom="0.375rem"
            >
              <Prim.Box display="flex" alignItems="center" gap="0.5rem">
                <Badge variant="primary">{e.method}</Badge>
                <Prim.Text style={{ ...MONO, fontWeight: 600 }}>{e.name}</Prim.Text>
                {e.route ? (
                  <Caption muted>
                    <Prim.Text style={MONO}>{e.route}</Prim.Text>
                  </Caption>
                ) : null}
              </Prim.Box>
              {e.description ? <Caption muted>{e.description}</Caption> : null}
              {e.input || e.output ? (
                <Caption muted>
                  <Prim.Text style={MONO}>
                    {e.input ? `in: ${e.input}` : ''}
                    {e.input && e.output ? '  ' : ''}
                    {e.output ? `out: ${e.output}` : ''}
                  </Prim.Text>
                </Caption>
              ) : null}
            </Card>
          ))
        )}
      </Prim.Box>

      {/* Hooks */}
      <Prim.Box style={SECTION}>
        <Prim.Box style={SUBTLE}>Hooks ({m.hooks?.length ?? 0})</Prim.Box>
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
      </Prim.Box>
    </Prim.Box>
  )
}

function Centered({ children, destructive }: { children: React.ReactNode; destructive?: boolean }) {
  return (
    <Prim.Box
      display="flex" alignItems="center" justifyContent="center" height="100%" padding="2rem" textAlign="center" opacity={destructive ? 1 : 0.6} color={destructive ? 'var(--color-destructive)' : 'inherit'} fontSize="0.875rem"
    >
      {/* SPIKE C: this file's `React.ReactNode` resolves to @types/react@19 while the primitives
          are built against 18, and the two unions differ. Same class of cast as `_tamagui.tsx`. */}
      {children as never}
    </Prim.Box>
  )
}

function formatTime(t: number | string): string {
  const d = typeof t === 'number' ? new Date(t) : new Date(t)
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString()
}

export const Route = createFileRoute('/studio/$projectId/app/')({
  component: ManifestView,
})

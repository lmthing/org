/**
 * InstallPanel — in-studio browse/install surface for store-published
 * "integration" spaces (see INTEGRATIONS_PROGRESS.md §5).
 *
 * Fetches the store catalog from the pod (`GET /api/store/spaces`, which
 * proxies the store manifest), filters to `tags.includes('integration')`,
 * and installs into the current project via
 * `POST /api/store/spaces/install { spaceId, projectId }`. On a divergence
 * conflict (`{ ok:false, diverged:true }`) offers a "Reinstall (overwrite)"
 * that re-POSTs with `force:true`.
 *
 * Uses the same pod `authFetch` + `dataPlaneOrigin('computer')` convention as
 * the rest of the shared UI (see `elements/settings/*`).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@lmthing/auth'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Panel, PanelHeader, PanelBody } from '@lmthing/ui/elements/content/panel'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { dataPlaneOrigin } from '@lmthing/ui/lib/app-urls'
import { buildProjectSettingsPath } from '@lmthing/ui/lib/space-path'

/** `CatalogSpace` per INTEGRATIONS_PROGRESS.md §2 (`store/projects/manifest.json`). */
interface CatalogSpace {
  id: string
  title: string
  description: string
  icon: string | null
  tags: string[]
  kind: string | null
  settings: unknown
  files: string[]
}

type InstallState = 'idle' | 'installing' | 'installed' | 'diverged' | 'error'

interface InstallStatus {
  state: InstallState
  message?: string
}

export interface InstallPanelProps {
  /** Project to install into — forwarded as `projectId` on the install POST. */
  projectId: string
  className?: string
}

/** Browse the store's integration spaces and install one into `projectId`. */
export function InstallPanel({ projectId, className }: InstallPanelProps) {
  const { authFetch, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const COMPUTER = dataPlaneOrigin('computer')

  const [spaces, setSpaces] = useState<CatalogSpace[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, InstallStatus>>({})

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    let cancelled = false
    authFetch(`${COMPUTER}/api/store/spaces`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const all = Array.isArray(data?.spaces) ? (data.spaces as CatalogSpace[]) : []
        setSpaces(all.filter((s) => Array.isArray(s.tags) && s.tags.includes('integration')))
      })
      .catch(() => {
        if (!cancelled) setLoadError('Failed to load the integration catalog.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, isAuthenticated, COMPUTER])

  const install = async (spaceId: string, force = false) => {
    setStatus((prev) => ({ ...prev, [spaceId]: { state: 'installing' } }))
    try {
      const res = await authFetch(`${COMPUTER}/api/store/spaces/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, projectId, ...(force ? { force: true } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (data?.ok) {
        setStatus((prev) => ({ ...prev, [spaceId]: { state: 'installed' } }))
        return
      }
      if (data?.diverged) {
        setStatus((prev) => ({
          ...prev,
          [spaceId]: { state: 'diverged', message: data.message ?? 'Installed copy has local changes.' },
        }))
        return
      }
      throw new Error(data?.error ?? `Install failed (${res.status})`)
    } catch (err) {
      setStatus((prev) => ({
        ...prev,
        [spaceId]: { state: 'error', message: err instanceof Error ? err.message : 'Install failed' },
      }))
    }
  }

  if (!isAuthenticated) return <Caption muted>Log in to browse integrations.</Caption>
  if (loading) return <Caption muted>Loading the integration catalog…</Caption>
  if (loadError) return <Caption className="text-destructive">{loadError}</Caption>

  return (
    <Panel className={className}>
      <PanelHeader>
        <span>Install an integration</span>
      </PanelHeader>
      <PanelBody>
        {spaces.length === 0 ? (
          <Caption muted>No integrations are published in the store yet.</Caption>
        ) : (
          <Stack gap="lg">
            {spaces.map((space) => {
              const st = status[space.id]?.state ?? 'idle'
              return (
                <Stack key={space.id} row gap="md" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Stack gap="sm">
                    <Stack row gap="sm" style={{ alignItems: 'center' }}>
                      {space.icon && <span aria-hidden="true">{space.icon}</span>}
                      <Heading level={4}>{space.title}</Heading>
                    </Stack>
                    <Caption muted>{space.description}</Caption>
                    {st === 'diverged' && (
                      <Caption className="text-destructive">{status[space.id]?.message}</Caption>
                    )}
                    {st === 'error' && (
                      <Caption className="text-destructive">{status[space.id]?.message}</Caption>
                    )}
                    {st === 'installed' && (
                      <Caption muted>
                        Installed. Paste tokens in{' '}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => navigate({ to: buildProjectSettingsPath(projectId) })}
                        >
                          Settings → Integrations
                        </button>
                        .
                      </Caption>
                    )}
                  </Stack>
                  <Stack style={{ flexShrink: 0 }}>
                    {st === 'diverged' ? (
                      <Button variant="destructive" size="sm" onClick={() => install(space.id, true)}>
                        Reinstall (overwrite)
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => install(space.id)}
                        disabled={st === 'installing' || st === 'installed'}
                      >
                        {st === 'installing' ? 'Installing…' : st === 'installed' ? 'Installed' : 'Install'}
                      </Button>
                    )}
                  </Stack>
                </Stack>
              )
            })}
          </Stack>
        )}
      </PanelBody>
    </Panel>
  )
}

export { InstallPanel as default }

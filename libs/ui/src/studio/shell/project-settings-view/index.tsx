/**
 * ProjectSettingsView — the `/studio/$projectId/settings` landing.
 *
 * Currently hosts one section, **Integrations**: every integration space
 * installed into this project (via {@link InstallPanel}, hosted on
 * {@link StudioProjectView}) gets a settings form generated from its
 * `settings` JSON Schema ({@link SettingsSchemaForm}). Field values are
 * pod-global env vars — loaded/saved via the gateway GET/PUT
 * `/api/compute/env`, the same GET-merge-PUT convention the former global
 * Integrations tab used (`elements/settings/integrations`, now removed).
 */
import '@lmthing/css/elements/layouts/split-pane/index.css'
import '@lmthing/css/elements/layouts/page/index.css'
import '@lmthing/css/elements/content/panel/index.css'
import '@lmthing/css/components/shell/studio-shell/index.css'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useAuth } from '@lmthing/auth'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Panel, PanelHeader, PanelBody } from '@lmthing/ui/elements/content/panel'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { dataPlaneOrigin } from '@lmthing/ui/lib/app-urls'
import { buildProjectPath } from '@lmthing/ui/lib/space-path'
import { StudioAppSidebar } from '../studio-app-sidebar'
import { SettingsSchemaForm, type JsonSchema } from '../../integrations/SettingsSchemaForm'

/** `InstalledIntegration` per INTEGRATIONS_PROGRESS.md §3. */
interface InstalledIntegration {
  spaceId: string
  title: string
  icon: string | null
  tags: string[]
  settings: JsonSchema | null
}

function schemaKeys(schema: JsonSchema | null | undefined): string[] {
  return schema?.properties ? Object.keys(schema.properties) : []
}

export function ProjectSettingsView() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string }
  const navigate = useNavigate()
  const { authFetch, isAuthenticated } = useAuth()
  const COMPUTER = dataPlaneOrigin('computer')
  const CLOUD = dataPlaneOrigin('cloud')

  const [integrations, setIntegrations] = useState<InstalledIntegration[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const allKeys = useMemo(
    () => Array.from(new Set((integrations ?? []).flatMap((i) => schemaKeys(i.settings)))),
    [integrations],
  )

  // Load the integrations installed in this project.
  useEffect(() => {
    if (!projectId || !isAuthenticated) return
    let cancelled = false
    authFetch(`${COMPUTER}/api/projects/${encodeURIComponent(projectId)}/integrations`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        setIntegrations(Array.isArray(data?.integrations) ? data.integrations : [])
      })
      .catch(() => {
        if (!cancelled) setLoadError('Failed to load installed integrations.')
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, isAuthenticated, COMPUTER, projectId])

  // Once we know which env vars matter, pull their current values from the pod.
  useEffect(() => {
    if (!isAuthenticated || allKeys.length === 0) return
    let cancelled = false
    authFetch(`${CLOUD}/api/compute/env`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.vars) return
        const cur = data.vars as Record<string, string>
        setFields((prev) => ({ ...Object.fromEntries(allKeys.map((k) => [k, cur[k] ?? ''])), ...prev }))
      })
      .catch(() => {
        /* best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, isAuthenticated, CLOUD, allKeys])

  const save = async () => {
    if (!isAuthenticated) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      // PUT replaces the whole var set — re-read fresh and overlay only the
      // integration fields on this page before saving.
      const cur = await authFetch(`${CLOUD}/api/compute/env`).then((r) => r.json()).catch(() => ({ vars: {} }))
      const all = { ...((cur.vars ?? {}) as Record<string, string>) }
      for (const k of allKeys) all[k] = fields[k] ?? ''
      const res = await authFetch(`${CLOUD}/api/compute/env`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: all }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setSaved(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="split-pane studio-shell">
      <StudioAppSidebar className="shrink-0" />
      <div className="split-pane__primary">
        <div className="page__body">
          <Stack gap="lg">
            <Stack gap="sm">
              <Heading level={2}>Project Settings</Heading>
              <Caption muted>{projectId || 'No project selected'}</Caption>
            </Stack>

            <Stack gap="md">
              <Heading level={3}>Integrations</Heading>

              {!isAuthenticated ? (
                <Caption muted>Log in to manage integrations.</Caption>
              ) : integrations === null ? (
                <Caption muted>Loading…</Caption>
              ) : loadError ? (
                <Caption className="text-destructive">{loadError}</Caption>
              ) : integrations.length === 0 ? (
                <Panel>
                  <PanelBody>
                    <Stack gap="sm">
                      <Caption muted>
                        No integrations installed in this project yet. Install one from the store to get
                        started.
                      </Caption>
                      <Button
                        variant="outline"
                        size="sm"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => navigate({ to: buildProjectPath(projectId) })}
                      >
                        Browse the store
                      </Button>
                    </Stack>
                  </PanelBody>
                </Panel>
              ) : (
                <Stack gap="lg">
                  {integrations.map((integration) => (
                    <Panel key={integration.spaceId}>
                      <PanelHeader>
                        <Stack row gap="sm" style={{ alignItems: 'center' }}>
                          {integration.icon && <span aria-hidden="true">{integration.icon}</span>}
                          <span>{integration.title}</span>
                        </Stack>
                      </PanelHeader>
                      <PanelBody>
                        {integration.settings && schemaKeys(integration.settings).length > 0 ? (
                          <SettingsSchemaForm
                            schema={integration.settings}
                            values={fields}
                            onChange={(key, value) => setFields((prev) => ({ ...prev, [key]: value }))}
                          />
                        ) : (
                          <Caption muted>This integration has no configurable settings.</Caption>
                        )}
                      </PanelBody>
                    </Panel>
                  ))}
                </Stack>
              )}
            </Stack>

            {integrations && integrations.length > 0 && (
              <Stack gap="sm">
                {saveError && <Caption className="text-destructive">{saveError}</Caption>}
                {saved && <Caption muted>Saved. Pod is restarting to apply changes.</Caption>}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={save}
                  disabled={saving}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {saving ? 'Saving…' : 'Save & Restart Pod'}
                </Button>
              </Stack>
            )}
          </Stack>
        </div>
      </div>
    </div>
  )
}

export { ProjectSettingsView as default }

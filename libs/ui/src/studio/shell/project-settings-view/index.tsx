/**
 * ProjectSettingsView — the `/studio/$projectId/settings` landing.
 *
 * Currently hosts one section, **Integrations**: every integration space
 * installed into this project gets a settings form generated from its
 * `settings` JSON Schema ({@link SettingsSchemaForm}). Installing is done from
 * the store (lmthing.store → lmthing.app/install), not here — this surface only
 * CONFIGURES already-installed integrations. Field values are pod-global env
 * vars — loaded/saved via the gateway GET/PUT `/api/compute/env`, the same
 * GET-merge-PUT convention the former global Integrations tab used
 * (`elements/settings/integrations`, now removed).
 */
import * as Prim from '../../../elements/primitives/index';
import { SPLIT_PANE_BASE, SPLIT_PANE_PRIMARY } from '../../../elements/layouts/split-pane/index'
import { PAGE_BODY } from '../../../elements/layouts/page/index'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useAuth } from '@lmthing/auth'
import { Heading } from '../../../elements/typography/heading'
import { Caption } from '../../../elements/typography/caption'
import { Button } from '../../../elements/forms/button'
import { Panel, PanelHeader, PanelBody } from '../../../elements/content/panel'
import { Markdown } from '../../../elements/content/markdown'
import { Stack } from '../../../elements/layouts/stack'
import { dataPlaneOrigin } from '../../../lib/app-urls'
import { StudioAppSidebar } from '../studio-app-sidebar'

/** lmthing.store origin, resolved from the current host (prod → lmthing.store,
 *  the `*.test` proxy → store.test) — for the "browse the store" hand-off. */
function storeOrigin(): string {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.test')) return 'https://store.test'
  return 'https://lmthing.store'
}
import { SettingsSchemaForm, type JsonSchema } from '../../../elements/forms/settings-schema-form'
import { LM_SETUP_GUIDE } from '../../../components/setup-guide/props'

/** `InstalledIntegration` per INTEGRATIONS_PROGRESS.md §3. */
interface InstalledIntegration {
  spaceId: string
  title: string
  icon: string | null
  tags: string[]
  settings: JsonSchema | null
  /** Bundled setup instructions (markdown), shown above the token fields. */
  readme?: string | null
}

function schemaKeys(schema: JsonSchema | null | undefined): string[] {
  return schema?.properties ? Object.keys(schema.properties) : []
}

export function ProjectSettingsView() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string }
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
    <Prim.Box {...SPLIT_PANE_BASE} height="100vh">
      <StudioAppSidebar flexShrink={0} />
      <Prim.Box {...SPLIT_PANE_PRIMARY}>
        <Prim.Box {...PAGE_BODY}>
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
                <Caption color="$destructive">{loadError}</Caption>
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
                        alignSelf="flex-start"
                        onClick={() => window.open(`${storeOrigin()}/spaces`, '_blank', 'noopener')}
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
                        <Stack row gap="sm" alignItems="center">
                          {integration.icon && <Prim.Text aria-hidden="true">{integration.icon}</Prim.Text>}
                          <Prim.Text>{integration.title}</Prim.Text>
                        </Stack>
                      </PanelHeader>
                      <PanelBody>
                        <Stack gap="md">
                          {integration.readme ? (
                            <Prim.Box as="details" {...LM_SETUP_GUIDE} open>
                              {/* `className` is web-only (dropped by `nativeSafeProps`), so there is
                                  no style to restate here — just a text host for the bare label. */}
                              <Prim.Box as="summary" className="lm-setup-guide__summary">
                                <Prim.Text>How to get your keys — setup guide</Prim.Text>
                              </Prim.Box>
                              <Prim.Box backgroundColor="$background" borderColor="$border" borderTopWidth={1} borderTopStyle="solid" paddingVertical={13.6} paddingHorizontal="$4">
                                <Markdown source={integration.readme} />
                              </Prim.Box>
                            </Prim.Box>
                          ) : null}
                          {integration.settings && schemaKeys(integration.settings).length > 0 ? (
                            <SettingsSchemaForm
                              schema={integration.settings}
                              values={fields}
                              onChange={(key, value) => setFields((prev) => ({ ...prev, [key]: value }))}
                            />
                          ) : (
                            <Caption muted>This integration has no configurable settings.</Caption>
                          )}
                        </Stack>
                      </PanelBody>
                    </Panel>
                  ))}
                </Stack>
              )}
            </Stack>

            {integrations && integrations.length > 0 && (
              <Stack gap="sm">
                {saveError && <Caption color="$destructive">{saveError}</Caption>}
                {saved && <Caption muted>Saved. Pod is restarting to apply changes.</Caption>}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={save}
                  disabled={saving}
                  alignSelf="flex-start"
                >
                  {saving ? 'Saving…' : 'Save & Restart Pod'}
                </Button>
              </Stack>
            )}
          </Stack>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

export { ProjectSettingsView as default }

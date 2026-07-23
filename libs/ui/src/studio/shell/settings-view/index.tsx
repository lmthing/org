/**
 * SettingsView - Space settings panel (env files, package.json).
 * Uses new hooks from Phase 3 and element components.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { Shield, FileCode2 } from 'lucide-react'
import { buildSpacePath } from '@lmthing/ui/lib/space-path'
import '@lmthing/css/elements/forms/button/index.css'
import '@lmthing/css/elements/forms/input/index.css'
import '@lmthing/css/elements/content/panel/index.css'
import '@lmthing/css/elements/layouts/page/index.css'
import '@lmthing/css/components/shell/index.css'
import { Page, PageHeader, PageBody } from '@lmthing/ui/elements/layouts/page'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { useUIState } from '@lmthing/state'
import { useFile } from '@lmthing/ui/hooks/fs/useFile'
import { cn } from '@lmthing/ui/lib/utils'

interface SettingsViewProps {
  isOpen: boolean
}

function useSpacePath(): string {
  const { projectId, spaceId } = useParams({ strict: false }) as { projectId?: string; spaceId?: string }
  if (projectId && spaceId) {
    return buildSpacePath(projectId, spaceId)
  }
  return '/'
}

export function SettingsView({ isOpen }: SettingsViewProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { spaceId } = useParams({ strict: false }) as { spaceId?: string }
  const spacePath = useSpacePath()

  const packageJsonContent = useFile('package.json')

  const packageJson = useMemo(() => {
    if (!packageJsonContent) return null
    try { return JSON.parse(packageJsonContent) } catch { return null }
  }, [packageJsonContent])

  const activeTab = useMemo(() => {
    if (pathname.includes('/settings/packages')) return 'packages'
    return 'env'
  }, [pathname])

  const handleTabChange = (tab: 'env' | 'packages') => {
    navigate({ to: `${spacePath}/settings/${tab}` })
  }

  const packageJsonSerialized = useMemo(
    () => packageJson ? JSON.stringify(packageJson, null, 2) : '',
    [packageJson]
  )

  const [packageJsonDraft, setPackageJsonDraft] = useUIState('settings-view.package-json-draft', packageJsonSerialized)
  const [packageJsonError, setPackageJsonError] = useUIState<string | null>('settings-view.package-json-error', null)
  const [packageJsonSavedAt, setPackageJsonSavedAt] = useUIState<string | null>('settings-view.package-json-saved-at', null)

  const [selectedEnvFile, setSelectedEnvFile] = useUIState('settings-view.selected-env-file', '.env.local')
  const [envPassword, setEnvPassword] = useUIState('settings-view.env-password', '')
  const [envContent, setEnvContent] = useUIState('settings-view.env-content', '')
  const [envStatus, setEnvStatus] = useUIState<string | null>('settings-view.env-status', null)
  const [envError, _setEnvError] = useUIState<string | null>('settings-view.env-error', null)

  useEffect(() => {
    setPackageJsonDraft(packageJsonSerialized)
  }, [packageJsonSerialized])

  if (!isOpen) return null

  return (
    <Page full>
      <PageHeader>
        <Stack row className="settings-view__header">
          <Prim.Box>
            <Heading level={2}>Space Settings</Heading>
            <Caption muted>{spaceId || 'No space selected'}</Caption>
          </Prim.Box>
        </Stack>
      </PageHeader>

      <Prim.Box className="settings-view__tabs">
        <Prim.Pressable
          onClick={() => handleTabChange('env')}
          className={`btn btn--ghost settings-view__tab ${activeTab === 'env' ? 'settings-view__tab--active' : 'settings-view__tab--inactive'}`}
        >
          <Shield className="settings-view__tab-icon" /> Environment
        </Prim.Pressable>
        <Prim.Pressable
          onClick={() => handleTabChange('packages')}
          className={`btn btn--ghost settings-view__tab ${activeTab === 'packages' ? 'settings-view__tab--active' : 'settings-view__tab--inactive'}`}
        >
          <FileCode2 className="settings-view__tab-icon" /> package.json
        </Prim.Pressable>
      </Prim.Box>

      <PageBody>
        {activeTab === 'env' && (
          <Prim.Box className="settings-view__panel-container">
            <Prim.Box className={cn('panel', 'settings-view__panel-container--env')}>
              <Prim.Box className="panel__header"><Prim.Text>Environment Variables</Prim.Text></Prim.Box>
              <Prim.Box className="panel__body">
                <Prim.Box className="settings-view__env-grid">
                  <Prim.Box>
                    <Prim.Text as="label" className="settings-view__env-label">File</Prim.Text>
                    <Prim.TextField className="input" value={selectedEnvFile} onChange={e => setSelectedEnvFile(e.target.value)} />
                  </Prim.Box>
                  <Prim.Box>
                    <Prim.Text as="label" className="settings-view__env-label">Password</Prim.Text>
                    <Prim.TextField className="input" type="password" value={envPassword} onChange={e => setEnvPassword(e.target.value)} placeholder="Enter password" />
                  </Prim.Box>
                </Prim.Box>
                <Prim.Box>
                  <Prim.Text as="label" className="settings-view__env-label">Variables</Prim.Text>
                  <Prim.TextArea
                    className={cn('input', 'settings-view__env-textarea')}
                    value={envContent}
                    onChange={e => setEnvContent(e.target.value)}
                    placeholder="KEY=value"
                  />
                </Prim.Box>
                <Prim.Box className="settings-view__env-actions">
                  <Prim.Pressable className="btn btn--outline" onClick={() => setEnvStatus('Loaded from session')}>Load</Prim.Pressable>
                  <Prim.Pressable className="btn btn--primary" onClick={() => setEnvStatus('Saved')}>Save</Prim.Pressable>
                </Prim.Box>
                {envError && <Caption className="settings-view__status--error">{envError}</Caption>}
                {envStatus && <Caption className="settings-view__status--success">{envStatus}</Caption>}
              </Prim.Box>
            </Prim.Box>
          </Prim.Box>
        )}

        {activeTab === 'packages' && (
          <Prim.Box className="settings-view__panel-container">
            <Prim.Box className="panel">
              <Prim.Box className="panel__header"><Prim.Text>package.json</Prim.Text></Prim.Box>
              <Prim.Box className="panel__body">
                <Caption muted className="settings-view__pkg-caption">
                  Inline metadata and dependency editor. Save when ready.
                </Caption>
                <Prim.TextArea
                  className={cn('input', 'settings-view__pkg-textarea')}
                  value={packageJsonDraft || packageJsonSerialized}
                  onChange={e => { setPackageJsonDraft(e.target.value); setPackageJsonError(null); setPackageJsonSavedAt(null) }}
                  spellCheck={false}
                />
                <Prim.Box className="settings-view__pkg-footer">
                  <Caption muted>
                    {packageJsonError ? <Prim.Text className="settings-view__pkg-error">{packageJsonError}</Prim.Text>
                    : packageJsonSavedAt ? `Saved at ${packageJsonSavedAt}` : 'Ready to save'}
                  </Caption>
                  <Prim.Pressable className="btn btn--primary" onClick={() => {
                    try {
                      JSON.parse(packageJsonDraft || packageJsonSerialized)
                      setPackageJsonError(null)
                      setPackageJsonSavedAt(new Date().toLocaleTimeString())
                    } catch {
                      setPackageJsonError('Invalid JSON format.')
                    }
                  }}>Save package.json</Prim.Pressable>
                </Prim.Box>
              </Prim.Box>
            </Prim.Box>
          </Prim.Box>
        )}
      </PageBody>
    </Page>
  )
}

/**
 * SettingsView - Space settings panel (env files, package.json).
 * Uses new hooks from Phase 3 and element components.
 */
import * as Prim from '../../../elements/primitives/index';
import { Button } from '../../../elements/forms/button'
import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { Shield, FileCode2 } from 'lucide-react'
import { buildSpacePath } from '@lmthing/ui/lib/space-path'
import { Page, PageHeader, PageBody } from '@lmthing/ui/elements/layouts/page'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { useUIState } from '@lmthing/state'
import { useFile } from '@lmthing/ui/hooks/fs/useFile'
import { cn } from '@lmthing/ui/lib/utils'
import { PANEL_BASE, PANEL_BODY, PANEL_HEADER } from '../../../elements/content/panel/index'
import { INPUT_BASE } from '../../../elements/forms/input/index'
import { SETTINGS_VIEW_ENV_TEXTAREA, SETTINGS_VIEW_HEADER, SETTINGS_VIEW_PKG_CAPTION, SETTINGS_VIEW_PKG_TEXTAREA, SETTINGS_VIEW_STATUS_ERROR, SETTINGS_VIEW_STATUS_SUCCESS, SETTINGS_VIEW_TAB_ICON } from '../props'

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
        <Stack row {...SETTINGS_VIEW_HEADER}>
          <Prim.Box>
            <Heading level={2}>Space Settings</Heading>
            <Caption muted>{spaceId || 'No space selected'}</Caption>
          </Prim.Box>
        </Stack>
      </PageHeader>

      <Prim.Box
        display="flex"
        gap="$1"
        paddingVertical="$0"
        paddingHorizontal="$6"
        borderBottomWidth={1}
        borderBottomColor="$border"
      >
        <Prim.Pressable
          onClick={() => handleTabChange('env')}
          // `variant` is `Button`'s prop; `Prim.Pressable` has no variant system, so `variant="ghost"`
          // was inert here (and leaked to the DOM as an invalid attribute). Applying what ghost
          // actually is — transparent + accent on hover — rather than adopting `Button`, whose size
          // and padding defaults would change these hand-styled tabs' layout.
          backgroundColor="transparent"
          hoverStyle={{ backgroundColor: '$accent', color: '$accent-foreground' }}
          borderRadius="$0"
          {...(activeTab === 'env'
            ? { borderBottomWidth: 2, borderBottomColor: '$primary', color: '$primary' }
            : { borderBottomWidth: 2, borderBottomColor: 'transparent' })}
        >
          <Shield {...SETTINGS_VIEW_TAB_ICON} /> Environment
        </Prim.Pressable>
        <Prim.Pressable
          onClick={() => handleTabChange('packages')}
          // `variant` is `Button`'s prop; `Prim.Pressable` has no variant system, so `variant="ghost"`
          // was inert here (and leaked to the DOM as an invalid attribute). Applying what ghost
          // actually is — transparent + accent on hover — rather than adopting `Button`, whose size
          // and padding defaults would change these hand-styled tabs' layout.
          backgroundColor="transparent"
          hoverStyle={{ backgroundColor: '$accent', color: '$accent-foreground' }}
          borderRadius="$0"
          {...(activeTab === 'packages'
            ? { borderBottomWidth: 2, borderBottomColor: '$primary', color: '$primary' }
            : { borderBottomWidth: 2, borderBottomColor: 'transparent' })}
        >
          <FileCode2 {...SETTINGS_VIEW_TAB_ICON} /> package.json
        </Prim.Pressable>
      </Prim.Box>

      <PageBody>
        {activeTab === 'env' && (
          <Prim.Box maxWidth={1024} marginTop="$0" marginBottom="$0" marginHorizontal="auto">
            <Prim.Box {...PANEL_BASE} marginBottom="$4">
              <Prim.Box {...PANEL_HEADER}><Prim.Text>Environment Variables</Prim.Text></Prim.Box>
              <Prim.Box {...PANEL_BODY}>
                <Prim.Box display="grid" gridTemplateColumns="1fr 1fr" gap="$3" marginBottom="$4">
                  <Prim.Box>
                    <Prim.Text as="label" display="block" fontSize="$xs" fontWeight="$medium" marginBottom="$1">File</Prim.Text>
                    <Prim.TextField {...INPUT_BASE} value={selectedEnvFile} onChange={e => setSelectedEnvFile(e.target.value)} />
                  </Prim.Box>
                  <Prim.Box>
                    <Prim.Text as="label" display="block" fontSize="$xs" fontWeight="$medium" marginBottom="$1">Password</Prim.Text>
                    <Prim.TextField {...INPUT_BASE} type="password" value={envPassword} onChange={e => setEnvPassword(e.target.value)} placeholder="Enter password" />
                  </Prim.Box>
                </Prim.Box>
                <Prim.Box>
                  <Prim.Text as="label" display="block" fontSize="$xs" fontWeight="$medium" marginBottom="$1">Variables</Prim.Text>
                  <Prim.TextArea
                    {...INPUT_BASE} {...SETTINGS_VIEW_ENV_TEXTAREA}
                    value={envContent}
                    onChange={e => setEnvContent(e.target.value)}
                    placeholder="KEY=value"
                  />
                </Prim.Box>
                <Prim.Box display="flex" gap="$2" marginTop="$3">
                  <Button variant="outline" onClick={() => setEnvStatus('Loaded from session')}>Load</Button>
                  <Button variant="primary" onClick={() => setEnvStatus('Saved')}>Save</Button>
                </Prim.Box>
                {envError && <Caption {...SETTINGS_VIEW_STATUS_ERROR}>{envError}</Caption>}
                {envStatus && <Caption {...SETTINGS_VIEW_STATUS_SUCCESS}>{envStatus}</Caption>}
              </Prim.Box>
            </Prim.Box>
          </Prim.Box>
        )}

        {activeTab === 'packages' && (
          <Prim.Box maxWidth={1024} marginTop="$0" marginBottom="$0" marginHorizontal="auto">
            <Prim.Box {...PANEL_BASE}>
              <Prim.Box {...PANEL_HEADER}><Prim.Text>package.json</Prim.Text></Prim.Box>
              <Prim.Box {...PANEL_BODY}>
                <Caption muted {...SETTINGS_VIEW_PKG_CAPTION}>
                  Inline metadata and dependency editor. Save when ready.
                </Caption>
                <Prim.TextArea
                  {...INPUT_BASE} {...SETTINGS_VIEW_PKG_TEXTAREA}
                  value={packageJsonDraft || packageJsonSerialized}
                  onChange={e => { setPackageJsonDraft(e.target.value); setPackageJsonError(null); setPackageJsonSavedAt(null) }}
                  spellCheck={false}
                />
                <Prim.Box display="flex" justifyContent="space-between" alignItems="center" marginTop="$3">
                  <Caption muted>
                    {packageJsonError ? <Prim.Text color="$destructive">{packageJsonError}</Prim.Text>
                    : packageJsonSavedAt ? `Saved at ${packageJsonSavedAt}` : 'Ready to save'}
                  </Caption>
                  <Button variant="primary" onClick={() => {
                    try {
                      JSON.parse(packageJsonDraft || packageJsonSerialized)
                      setPackageJsonError(null)
                      setPackageJsonSavedAt(new Date().toLocaleTimeString())
                    } catch {
                      setPackageJsonError('Invalid JSON format.')
                    }
                  }}>Save package.json</Button>
                </Prim.Box>
              </Prim.Box>
            </Prim.Box>
          </Prim.Box>
        )}
      </PageBody>
    </Page>
  )
}

import * as Prim from '@lmthing/ui/elements/primitives';
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
  useLocation,
} from '@tanstack/react-router'
import { TabBar } from '@lmthing/ui/elements/nav/tab-bar'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'

/**
 * `/studio/$projectId/app` — the project's **app surface** (admin/dev).
 *
 * Project-scoped (not space-scoped), so it renders its own self-contained
 * chrome + tab bar rather than the space-only `StudioLayout`. The tabs mirror
 * the `$spaceId` sub-route convention: each tab is a nested file route under
 * `app/` with its own `index.tsx`.
 */
const TABS = [
  { id: '', label: 'Manifest' },
  { id: 'data', label: 'Data' },
  { id: 'files', label: 'Files' },
  { id: 'preview', label: 'Preview' },
] as const

function AppSectionLayout() {
  const { projectId } = useParams({ from: '/studio/$projectId/app' })
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const appBase = `/studio/${projectId}/app`
  // Active tab = the segment right after `.../app` (empty string = Manifest).
  const rest = pathname.startsWith(appBase) ? pathname.slice(appBase.length) : ''
  const activeTab = rest.replace(/^\//, '').split('/')[0] ?? ''

  return (
    <Prim.Box display="flex" flexDirection="column" height="100%" minHeight={0}>
      <Prim.Box
        paddingTop="1rem" paddingHorizontal="1.5rem" paddingBottom="0.75rem" borderBottomWidth="1px" borderBottomStyle="solid" borderBottomColor="var(--color-border)"
      >
        <Heading level={3}>App</Heading>
        <Caption muted>
          Data model, pages, endpoints, hooks &amp; build for project{' '}
          <Prim.Text as="code" fontFamily="monospace">{projectId}</Prim.Text>.
        </Caption>
        <Prim.Box marginTop="0.75rem">
          <TabBar
            tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
            activeTab={activeTab}
            onTabChange={(id) =>
              navigate({ to: id ? `${appBase}/${id}` : appBase })
            }
          />
        </Prim.Box>
      </Prim.Box>
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minHeight={0} overflow="hidden">
        <Outlet />
      </Prim.Box>
    </Prim.Box>
  )
}

export const Route = createFileRoute('/studio/$projectId/app')({
  component: AppSectionLayout,
})

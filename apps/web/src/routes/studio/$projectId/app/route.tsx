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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          padding: '1rem 1.5rem 0.75rem',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Heading level={3}>App</Heading>
        <Caption muted>
          Data model, pages, endpoints, hooks &amp; build for project{' '}
          <code style={{ fontFamily: 'monospace' }}>{projectId}</code>.
        </Caption>
        <div style={{ marginTop: '0.75rem' }}>
          <TabBar
            tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
            activeTab={activeTab}
            onTabChange={(id) =>
              navigate({ to: id ? `${appBase}/${id}` : appBase })
            }
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Outlet />
      </div>
    </div>
  )
}

export const Route = createFileRoute('/studio/$projectId/app')({
  component: AppSectionLayout,
})

/**
 * StudioShell - Primary shell component managing space views and panels.
 * Uses composite hooks and element CSS classes.
 * Orchestrates the sidebar, content area, and settings/knowledge views.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { SPLIT_PANE_BASE, SPLIT_PANE_PRIMARY } from '../../../elements/layouts/split-pane/index.js'
import { PAGE_BODY } from '../../../elements/layouts/page/index.js'
import { useCallback, useMemo } from 'react'
import { useToggle } from '@lmthing/state'
import { useParams, useLocation, useNavigate } from '@tanstack/react-router'
import { buildSpacePath } from '@lmthing/ui/lib/space-path'
import { StudioSidebar } from '../studio-sidebar'
import { StudioAppSidebar } from '../studio-app-sidebar'
import { SettingsView } from '../settings-view'
import { useAgentList } from '@lmthing/ui/hooks/agent/useAgentList'
import { useKnowledgeFields } from '@lmthing/ui/hooks/knowledge/useKnowledgeFields'
import { useWorkflowList } from '@lmthing/ui/hooks/workflow/useWorkflowList'

export interface StudioShellProps {
  defaultSidebarCollapsed?: boolean
  onSidebarCollapsedChange?: (collapsed: boolean) => void
  onOpenSettings?: () => void
  onCreateField?: () => void
  onEditField?: (id: string) => void
  onDeleteField?: (id: string) => void
  onCreateAgent?: () => void
  onEditAgent?: (id: string) => void
  onDeleteAgent?: (id: string) => void
  onSelectFile?: (file: unknown) => void
  onToggleFolder?: (path: string) => void
  onExpandAll?: () => void
  onCollapseAll?: () => void
  onEditContent?: (content: string) => void
  onSave?: () => void
  onCreateFile?: (form: unknown) => void
  onCreateFolder?: (form: unknown) => void
  onRename?: (nodeId: string, newName: string) => void
  onMove?: (nodeId: string, newParentPath: string) => void
  onDelete?: (nodeId: string) => void
  onDuplicate?: (nodeId: string) => void
  user?: { name: string }
  children?: React.ReactNode
  /** Optional THING chat panel, docked on the right when toggled on. Built by
   *  the app (it needs auth + compute origin); the shell only shows/hides it. */
  rightPanel?: React.ReactNode
}

function useSpacePath(): string {
  const { projectId, spaceId } = useParams({ strict: false }) as { projectId?: string; spaceId?: string }
  if (projectId && spaceId) {
    return buildSpacePath(projectId, spaceId)
  }
  return '/'
}

export function StudioShell({
  defaultSidebarCollapsed = false,
  onSidebarCollapsedChange,
  onOpenSettings,
  onCreateField,
  onCreateAgent,
  children,
  rightPanel,
}: StudioShellProps) {
  const { agentId } = useParams({ strict: false }) as { agentId?: string }
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const spacePath = useSpacePath()
  const [sidebarCollapsed, , setSidebarCollapsed] = useToggle('studio-shell.sidebar.collapsed', defaultSidebarCollapsed)
  // THING chat dock — persisted, always-on while enabled (does not navigate).
  const [thingOpen, toggleThingOpen] = useToggle('studio-shell.thing.open', false)

  const agentList = useAgentList()
  const knowledgeFields = useKnowledgeFields()
  const workflowList = useWorkflowList()

  const handleToggleSidebar = useCallback(() => {
    const next = !sidebarCollapsed
    setSidebarCollapsed(next)
    onSidebarCollapsedChange?.(next)
  }, [sidebarCollapsed, onSidebarCollapsedChange])

  const activeFieldId = useMemo(() => {
    const match = pathname.match(/\/knowledge\/([^/]+)/)
    return match ? match[1] : undefined
  }, [pathname])

  const isSettingsOpen = pathname.includes('/settings')

  return (
    <Prim.Box {...SPLIT_PANE_BASE} height="100vh">
      {/* Outer shared sidebar: project dropdown + collapsible spaces (same in chat). */}
      <StudioAppSidebar flexShrink={0} />

      {/* Inner rail: the open space's contents (knowledge / agents / tasklists). */}
      <StudioSidebar
        asRail
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        activeFieldId={activeFieldId}
        activeAgentId={agentId as string}
        onOpenSettings={onOpenSettings || (() => navigate({ to: `${spacePath}/settings/env` }))}
        onCreateField={onCreateField}
        onCreateAgent={onCreateAgent}
        thingOpen={thingOpen}
        onToggleThing={rightPanel ? toggleThingOpen : undefined}
      />

      <Prim.Box {...SPLIT_PANE_PRIMARY}>
        {isSettingsOpen ? (
          <SettingsView isOpen={true} />
        ) : (
          children || (
            <Prim.Box {...PAGE_BODY} display="flex" alignItems="center" justifyContent="center">
              <Prim.Box textAlign="center" opacity={0.5}>
                <Prim.Text as="p" fontSize="$lg" fontWeight="$semibold" marginBottom="$2">
                  Select a knowledge field or agent
                </Prim.Text>
                <Prim.Text as="p" fontSize="$sm">
                  {knowledgeFields.length} knowledge fields, {agentList.length} agents, {workflowList.length} tasklists
                </Prim.Text>
              </Prim.Box>
            </Prim.Box>
          )
        )}
      </Prim.Box>

      {rightPanel && thingOpen && (
        <Prim.Box
          width={400}
          flexGrow={0}
          flexShrink={0}
          flexBasis="400px"
          height="100%"
          borderLeftWidth={1}
          borderLeftStyle="solid"
          borderLeftColor="var(--border)"
          display="flex"
          flexDirection="column"
          minWidth={0}
          overflow="hidden"
        >
          {rightPanel}
        </Prim.Box>
      )}
    </Prim.Box>
  )
}

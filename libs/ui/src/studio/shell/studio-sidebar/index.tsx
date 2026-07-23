/**
 * StudioSidebar - Navigation sidebar for project/space sections.
 *
 * Uses composite hooks (useAgentList, useKnowledgeFields) and CSS element
 * classes. Renders knowledge fields, agents, raw files, settings, and a
 * collapse toggle.
 *
 * Removed under the pod-backed architecture: all GitHub connect/repo UI and
 * the `useGithub` dependency. Route params are now `$projectId`/`$spaceId`.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { useMemo } from 'react'
import { useToggle, useTasklistList, useGlob } from '@lmthing/state'
import { Link, useLocation, useParams } from '@tanstack/react-router'
import {
  Plus,
  Settings,
  ChevronLeft,
  ChevronRight,
  Folder,
  Bot,
  ChevronDown,
  ChevronRight as ChevronRightSmall,
  FileCode,
  ListChecks,
  FunctionSquare,
  Box,
  MessageSquare,
} from 'lucide-react'
import '@lmthing/css/elements/nav/sidebar/index.css'
import '@lmthing/css/components/shell/index.css'
import { buildSpacePath } from '@lmthing/ui/lib/space-path'
import { useAgentList } from '@lmthing/ui/hooks/agent/useAgentList'
import type { AgentListItem } from '@lmthing/ui/hooks/agent/useAgentList'
import { useKnowledgeFieldList } from '@lmthing/state'
import type { KnowledgeFieldMeta } from '@lmthing/state'
import { useAgent } from '@lmthing/ui/hooks/agent/useAgent'
import { CozyThingText } from '@lmthing/ui/elements/branding/cozy-text'
import { otherAppLinks } from '@lmthing/ui/lib/app-urls'

export interface StudioSidebarProps {
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  /** When true, render as an inner "space contents" rail: the brand header and
   *  cross-app links are hidden (the shared AppSidebar owns them now). */
  asRail?: boolean
  activeFieldId?: string
  activeAgentId?: string
  onOpenSettings?: () => void
  onCreateField?: () => void
  onCreateAgent?: () => void
  /** When provided, the THING footer entry toggles the right-side chat dock
   *  (instead of navigating). `thingOpen` reflects the dock's current state. */
  thingOpen?: boolean
  onToggleThing?: () => void
  onExportZip?: () => void
  onExportGithub?: () => void
  isExporting?: boolean
  exportProgress?: { uploadedFiles?: number; totalFiles?: number }
  canExport?: boolean
}

function useSpacePath(): string {
  const { projectId, spaceId } = useParams({ strict: false }) as { projectId?: string; spaceId?: string }
  if (projectId && spaceId) {
    return buildSpacePath(projectId, spaceId)
  }
  return '/'
}

export function StudioSidebar({
  isCollapsed = false,
  onToggleCollapse,
  asRail = false,
  activeFieldId,
  activeAgentId,
  onOpenSettings,
  onCreateField,
  onCreateAgent,
  thingOpen,
  onToggleThing,
}: StudioSidebarProps) {
  const { pathname } = useLocation()
  const { spaceId } = useParams({ strict: false }) as { spaceId?: string }
  const spacePath = useSpacePath()
  const [fieldsExpanded, toggleFieldsExpanded] = useToggle('sidebar.fields.expanded', true)
  const [agentsExpanded, toggleAgentsExpanded] = useToggle('sidebar.agents.expanded', true)
  const [tasklistsExpanded, toggleTasklistsExpanded] = useToggle('sidebar.tasklists.expanded', true)
  const [functionsExpanded, toggleFunctionsExpanded] = useToggle('sidebar.functions.expanded', true)
  const [componentsExpanded, toggleComponentsExpanded] = useToggle('sidebar.components.expanded', true)
  const [conversationsExpanded, toggleConversationsExpanded] = useToggle('sidebar.conversations.expanded', true)

  const agentList = useAgentList()
  const knowledgeFields = useKnowledgeFieldList()
  const activeAgent = useAgent(activeAgentId || '')
  const tasklistItems = useTasklistList()

  const agents = useMemo(() => {
    return agentList.map((item: AgentListItem) => ({
      id: item.id,
      name: item.id,
      path: item.path,
    }))
  }, [agentList])

  const fields = useMemo(() => {
    return knowledgeFields.map((f: KnowledgeFieldMeta) => ({
      id: f.fieldId,
      label: f.field,
      path: f.path,
    }))
  }, [knowledgeFields])

  // Functions (functions/<name>.ts) and components (components/{view,form}/<Name>.tsx).
  const functionPaths = useGlob('functions/*.ts')
  const viewComponentPaths = useGlob('components/view/*.tsx')
  const formComponentPaths = useGlob('components/form/*.tsx')

  const functions = useMemo(
    () =>
      functionPaths
        .map((p) => p.split('/').pop()!.replace(/\.ts$/, ''))
        .sort((a, b) => a.localeCompare(b)),
    [functionPaths],
  )
  const components = useMemo(
    () =>
      [
        ...viewComponentPaths.map((p) => ({ name: p.split('/').pop()!.replace(/\.tsx$/, ''), kind: 'view' as const })),
        ...formComponentPaths.map((p) => ({ name: p.split('/').pop()!.replace(/\.tsx$/, ''), kind: 'form' as const })),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [viewComponentPaths, formComponentPaths],
  )

  return (
    <Prim.Box as="aside" className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''}`}>
      {!asRail && (
        <Prim.Box className="studio-sidebar__header">
          <Prim.Box className="studio-sidebar__header-inner">
            <Link
              to="/studio"
              className="studio-sidebar__home-link"
              title="lmthing"
            >
              <CozyThingText text="lmthing" />
            </Link>
            {!isCollapsed && (
              <Prim.Text className="studio-sidebar__space-name">
                {spaceId || 'Space'}
              </Prim.Text>
            )}
          </Prim.Box>
        </Prim.Box>
      )}
      {asRail && !isCollapsed && (
        <Prim.Box className="studio-sidebar__header">
          <Prim.Box className="studio-sidebar__header-inner">
            <Prim.Text className="studio-sidebar__space-name">{spaceId || 'Space'}</Prim.Text>
          </Prim.Box>
        </Prim.Box>
      )}

      <Prim.Box className="studio-sidebar__body">
        {!isCollapsed ? (
          <Prim.Box className="studio-sidebar__sections">
            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleFieldsExpanded}
                className="sidebar__item studio-sidebar__section-header"
              >
                {fieldsExpanded ? <ChevronDown className="studio-sidebar__section-chevron" /> : <ChevronRightSmall className="studio-sidebar__section-chevron" />}
                Knowledge ({fields.length})
              </Prim.Pressable>
              {fieldsExpanded && (
                <Prim.Box className="studio-sidebar__section-items">
                  {fields.map(field => {
                    const href = `${spacePath}/knowledge/${encodeURIComponent(field.id)}`
                    const isActive = pathname === href || activeFieldId === field.id
                    return (
                      <Link key={field.id} to={href} className={`sidebar__item ${isActive ? 'sidebar__item--active' : ''}`}>
                        <Folder className="studio-sidebar__item-icon--knowledge" />
                        <Prim.Text className="studio-sidebar__item-label">{field.label}</Prim.Text>
                      </Link>
                    )
                  })}
                  <Prim.Pressable onClick={onCreateField} className="sidebar__item studio-sidebar__create-btn">
                    <Plus className="studio-sidebar__create-icon" />
                    <Prim.Text className="studio-sidebar__create-label">Create Field</Prim.Text>
                  </Prim.Pressable>
                </Prim.Box>
              )}
            </Prim.Box>

            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleAgentsExpanded}
                className="sidebar__item studio-sidebar__section-header"
              >
                {agentsExpanded ? <ChevronDown className="studio-sidebar__section-chevron" /> : <ChevronRightSmall className="studio-sidebar__section-chevron" />}
                Agents ({agents.length})
              </Prim.Pressable>
              {agentsExpanded && (
                <Prim.Box className="studio-sidebar__section-items">
                  {agents.map(agent => {
                    const href = `${spacePath}/agent/${agent.id}`
                    const isActive = pathname === href || activeAgentId === agent.id
                    return (
                      <Link key={agent.id} to={href} className={`sidebar__item ${isActive ? 'sidebar__item--active' : ''}`}>
                        <Bot className="studio-sidebar__item-icon--agent" />
                        <Prim.Text className="studio-sidebar__item-label">{agent.name}</Prim.Text>
                      </Link>
                    )
                  })}
                  <Prim.Pressable onClick={onCreateAgent} className="sidebar__item studio-sidebar__create-btn">
                    <Plus className="studio-sidebar__create-icon" />
                    <Prim.Text className="studio-sidebar__create-label">Create Agent</Prim.Text>
                  </Prim.Pressable>
                </Prim.Box>
              )}
            </Prim.Box>

            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleTasklistsExpanded}
                className="sidebar__item studio-sidebar__section-header"
              >
                {tasklistsExpanded ? <ChevronDown className="studio-sidebar__section-chevron" /> : <ChevronRightSmall className="studio-sidebar__section-chevron" />}
                Tasklists ({tasklistItems.length})
              </Prim.Pressable>
              {tasklistsExpanded && (
                <Prim.Box className="studio-sidebar__section-items">
                  {tasklistItems.map(item => {
                    const href = `${spacePath}/workflow/${item.name}`
                    const isActive = pathname.startsWith(href)
                    return (
                      <Link key={item.name} to={href} className={`sidebar__item ${isActive ? 'sidebar__item--active' : ''}`}>
                        <ListChecks className="studio-sidebar__item-icon--tasklist" />
                        <Prim.Text className="studio-sidebar__item-label">{item.name}</Prim.Text>
                      </Link>
                    )
                  })}
                  <Prim.Pressable onClick={onCreateAgent} className="sidebar__item studio-sidebar__create-btn">
                    <Plus className="studio-sidebar__create-icon" />
                    <Prim.Text className="studio-sidebar__create-label">Create Tasklist</Prim.Text>
                  </Prim.Pressable>
                </Prim.Box>
              )}
            </Prim.Box>

            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleFunctionsExpanded}
                className="sidebar__item studio-sidebar__section-header"
              >
                {functionsExpanded ? <ChevronDown className="studio-sidebar__section-chevron" /> : <ChevronRightSmall className="studio-sidebar__section-chevron" />}
                Functions ({functions.length})
              </Prim.Pressable>
              {functionsExpanded && (
                <Prim.Box className="studio-sidebar__section-items">
                  {functions.map(name => {
                    const href = `${spacePath}/functions`
                    return (
                      <Link key={name} to={href} className="sidebar__item">
                        <FunctionSquare className="studio-sidebar__item-icon--knowledge" />
                        <Prim.Text className="studio-sidebar__item-label">{name}</Prim.Text>
                      </Link>
                    )
                  })}
                  <Link to={`${spacePath}/functions`} className="sidebar__item studio-sidebar__create-btn">
                    <Plus className="studio-sidebar__create-icon" />
                    <Prim.Text className="studio-sidebar__create-label">Edit Functions</Prim.Text>
                  </Link>
                </Prim.Box>
              )}
            </Prim.Box>

            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleComponentsExpanded}
                className="sidebar__item studio-sidebar__section-header"
              >
                {componentsExpanded ? <ChevronDown className="studio-sidebar__section-chevron" /> : <ChevronRightSmall className="studio-sidebar__section-chevron" />}
                Components ({components.length})
              </Prim.Pressable>
              {componentsExpanded && (
                <Prim.Box className="studio-sidebar__section-items">
                  {components.map(c => (
                    <Link key={`${c.kind}/${c.name}`} to={`${spacePath}/components`} className="sidebar__item">
                      <Box className="studio-sidebar__item-icon--knowledge" />
                      <Prim.Text className="studio-sidebar__item-label">{c.name}</Prim.Text>
                      <Prim.Text className="studio-sidebar__item-badge" style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 11 }}>{c.kind}</Prim.Text>
                    </Link>
                  ))}
                  <Link to={`${spacePath}/components`} className="sidebar__item studio-sidebar__create-btn">
                    <Plus className="studio-sidebar__create-icon" />
                    <Prim.Text className="studio-sidebar__create-label">Edit Components</Prim.Text>
                  </Link>
                </Prim.Box>
              )}
            </Prim.Box>

            {activeAgentId && (
              <Prim.Box as="section">
                <Prim.Pressable
                  onClick={toggleConversationsExpanded}
                  className="sidebar__item studio-sidebar__section-header"
                >
                  {conversationsExpanded ? <ChevronDown className="studio-sidebar__section-chevron" /> : <ChevronRightSmall className="studio-sidebar__section-chevron" />}
                  Conversations (0)
                </Prim.Pressable>
                {conversationsExpanded && (
                  <Prim.Box className="sidebar__item studio-sidebar__conversations-empty">
                    No conversations yet.
                  </Prim.Box>
                )}
              </Prim.Box>
            )}
          </Prim.Box>
        ) : (
          <Prim.Box className="studio-sidebar__collapsed-icons">
            <Prim.Box className="sidebar__item studio-sidebar__collapsed-icon" title={`${fields.length} knowledge fields`}>
              <Folder className="studio-sidebar__collapsed-icon-inner" />
            </Prim.Box>
            <Prim.Box className="sidebar__item studio-sidebar__collapsed-icon" title={`${agents.length} agents`}>
              <Bot className="studio-sidebar__collapsed-icon-inner" />
            </Prim.Box>
          </Prim.Box>
        )}
      </Prim.Box>

      <Prim.Box className="studio-sidebar__footer">
        <Prim.Box className="studio-sidebar__footer-items">
          {onToggleThing ? (
            <Prim.Pressable
              onClick={onToggleThing}
              className={`sidebar__item ${thingOpen ? 'sidebar__item--active' : ''}`}
              title={thingOpen ? 'Hide THING chat' : 'Show THING chat'}
            >
              <MessageSquare className="studio-sidebar__footer-icon" />
              {!isCollapsed && <CozyThingText text="THING" className="studio-sidebar__footer-label" />}
            </Prim.Pressable>
          ) : (
            <Link to="/studio/thing" className={`sidebar__item ${pathname.startsWith('/studio/thing') ? 'sidebar__item--active' : ''}`}>
              <Prim.Text className="studio-sidebar__footer-icon" aria-hidden="true">🤖</Prim.Text>
              {!isCollapsed && <CozyThingText text="THING" className="studio-sidebar__footer-label" />}
            </Link>
          )}
          <Link to={`${spacePath}/raw`} className={`sidebar__item ${pathname.includes('/raw') ? 'sidebar__item--active' : ''}`}>
            <FileCode className="studio-sidebar__footer-icon" />
            {!isCollapsed && <Prim.Text className="studio-sidebar__footer-label">Raw Files</Prim.Text>}
          </Link>
          {!asRail && otherAppLinks('studio').map((link) => (
            <Prim.Link
              key={link.app}
              href={link.url}
              className="sidebar__item"
              title={`Open lmthing.${link.app}`}
            >
              <Prim.Text className="studio-sidebar__footer-icon" aria-hidden="true">{link.emoji}</Prim.Text>
              {!isCollapsed && <Prim.Text className="studio-sidebar__footer-label">{link.label}</Prim.Text>}
            </Prim.Link>
          ))}
          <Prim.Pressable onClick={onOpenSettings} className="sidebar__item">
            <Settings className="studio-sidebar__footer-icon" />
            {!isCollapsed && <Prim.Text className="studio-sidebar__footer-label">Settings</Prim.Text>}
          </Prim.Pressable>
          <Prim.Pressable onClick={onToggleCollapse} className="sidebar__item">
            {isCollapsed ? (
              <ChevronRight className="studio-sidebar__footer-icon" />
            ) : (
              <>
                <ChevronLeft className="studio-sidebar__footer-icon" />
                <Prim.Text className="studio-sidebar__footer-label">Collapse</Prim.Text>
              </>
            )}
          </Prim.Pressable>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

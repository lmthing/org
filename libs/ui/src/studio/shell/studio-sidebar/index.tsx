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
import * as Prim from '../../../elements/primitives/index';
import { useMemo } from 'react'
import { useToggle, useTasklistList, useGlob } from '@lmthing/state'
import { useLocation, useParams } from '@tanstack/react-router'
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
import { SIDEBAR_BASE, SIDEBAR_COLLAPSED, SIDEBAR_ITEM, SIDEBAR_ITEM_ACTIVE } from '../../../elements/nav/sidebar/index'
import { NavLink } from '../nav-link/index'
import { buildSpacePath } from '../../../lib/space-path'
import { useAgentList } from '../../../hooks/agent/useAgentList'
import type { AgentListItem } from '../../../hooks/agent/useAgentList'
import { useKnowledgeFieldList } from '@lmthing/state'
import type { KnowledgeFieldMeta } from '@lmthing/state'
import { useAgent } from '../../../hooks/agent/useAgent'
import { CozyThingText } from '../../../elements/branding/cozy-text'
import { otherAppLinks } from '../../../lib/app-urls'
import { STUDIO_SIDEBAR_COLLAPSED_ICON_INNER, STUDIO_SIDEBAR_CREATE_BTN, STUDIO_SIDEBAR_CREATE_ICON, STUDIO_SIDEBAR_FOOTER_ICON, STUDIO_SIDEBAR_FOOTER_LABEL, STUDIO_SIDEBAR_HOME_LINK, STUDIO_SIDEBAR_ITEM_ICON_KNOWLEDGE, STUDIO_SIDEBAR_SECTION_CHEVRON } from '../props'

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
    <Prim.Box as="aside" {...SIDEBAR_BASE} {...(isCollapsed ? SIDEBAR_COLLAPSED : {})}>
      {!asRail && (
        <Prim.Box padding="$0" borderBottomWidth={1} borderBottomColor="$border">
          <Prim.Box display="flex" alignItems="center" gap="$8" paddingLeft="$3">
            <NavLink
              to="/studio"
              {...STUDIO_SIDEBAR_HOME_LINK}
              title="lmthing"
            >
              <CozyThingText text="lmthing" />
            </NavLink>
            {!isCollapsed && (
              <Prim.Text fontSize="$sm" fontWeight="$semibold" flexGrow={1} flexShrink={1} flexBasis="0%" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                {spaceId || 'Space'}
              </Prim.Text>
            )}
          </Prim.Box>
        </Prim.Box>
      )}
      {asRail && !isCollapsed && (
        <Prim.Box padding="$0" borderBottomWidth={1} borderBottomColor="$border">
          <Prim.Box display="flex" alignItems="center" gap="$8" paddingLeft="$3">
            <Prim.Text fontSize="$sm" fontWeight="$semibold" flexGrow={1} flexShrink={1} flexBasis="0%" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{spaceId || 'Space'}</Prim.Text>
          </Prim.Box>
        </Prim.Box>
      )}

      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflowY="auto" overflowX="hidden" padding="$3" paddingTop="$8">
        {!isCollapsed ? (
          <Prim.Box display="flex" flexDirection="column" gap="$6">
            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleFieldsExpanded}
                {...SIDEBAR_ITEM}
                fontSize={10}
                fontWeight="$semibold"
                textTransform="uppercase"
                letterSpacing="$wider"
                opacity={0.7}
              >
                {fieldsExpanded ? <ChevronDown {...STUDIO_SIDEBAR_SECTION_CHEVRON} /> : <ChevronRightSmall {...STUDIO_SIDEBAR_SECTION_CHEVRON} />}
                {/* `Prim.Pressable` is an RN `View` — none of the text props above (`color` from
                    `SIDEBAR_ITEM`, `fontSize`/`fontWeight`/`textTransform`/`letterSpacing`) reach a
                    bare label, so all are restated on the wrapped `Prim.Text`. Repeated identically
                    for every section header below. */}
                <Prim.Text color={SIDEBAR_ITEM.color} fontSize={10} fontWeight="$semibold" textTransform="uppercase" letterSpacing="$wider">
                  Knowledge ({fields.length})
                </Prim.Text>
              </Prim.Pressable>
              {fieldsExpanded && (
                <Prim.Box display="flex" flexDirection="column" gap={2}>
                  {fields.map(field => {
                    const href = `${spacePath}/knowledge/${encodeURIComponent(field.id)}`
                    const isActive = pathname === href || activeFieldId === field.id
                    return (
                      <NavLink key={field.id} to={href} {...SIDEBAR_ITEM} {...(isActive ? SIDEBAR_ITEM_ACTIVE : {})}>
                        <Folder {...STUDIO_SIDEBAR_ITEM_ICON_KNOWLEDGE} />
                        <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{field.label}</Prim.Text>
                      </NavLink>
                    )
                  })}
                  <Prim.Pressable onClick={onCreateField} {...SIDEBAR_ITEM} opacity={0.6}>
                    <Plus {...STUDIO_SIDEBAR_CREATE_ICON} />
                    <Prim.Text fontWeight="$medium">Create Field</Prim.Text>
                  </Prim.Pressable>
                </Prim.Box>
              )}
            </Prim.Box>

            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleAgentsExpanded}
                {...SIDEBAR_ITEM}
                fontSize={10}
                fontWeight="$semibold"
                textTransform="uppercase"
                letterSpacing="$wider"
                opacity={0.7}
              >
                {agentsExpanded ? <ChevronDown {...STUDIO_SIDEBAR_SECTION_CHEVRON} /> : <ChevronRightSmall {...STUDIO_SIDEBAR_SECTION_CHEVRON} />}
                <Prim.Text color={SIDEBAR_ITEM.color} fontSize={10} fontWeight="$semibold" textTransform="uppercase" letterSpacing="$wider">
                  Agents ({agents.length})
                </Prim.Text>
              </Prim.Pressable>
              {agentsExpanded && (
                <Prim.Box display="flex" flexDirection="column" gap={2}>
                  {agents.map(agent => {
                    const href = `${spacePath}/agent/${agent.id}`
                    const isActive = pathname === href || activeAgentId === agent.id
                    return (
                      <NavLink key={agent.id} to={href} {...SIDEBAR_ITEM} {...(isActive ? SIDEBAR_ITEM_ACTIVE : {})}>
                        <Bot />
                        <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{agent.name}</Prim.Text>
                      </NavLink>
                    )
                  })}
                  <Prim.Pressable onClick={onCreateAgent} {...SIDEBAR_ITEM} opacity={0.6}>
                    <Plus {...STUDIO_SIDEBAR_CREATE_ICON} />
                    <Prim.Text fontWeight="$medium">Create Agent</Prim.Text>
                  </Prim.Pressable>
                </Prim.Box>
              )}
            </Prim.Box>

            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleTasklistsExpanded}
                {...SIDEBAR_ITEM}
                fontSize={10}
                fontWeight="$semibold"
                textTransform="uppercase"
                letterSpacing="$wider"
                opacity={0.7}
              >
                {tasklistsExpanded ? <ChevronDown {...STUDIO_SIDEBAR_SECTION_CHEVRON} /> : <ChevronRightSmall {...STUDIO_SIDEBAR_SECTION_CHEVRON} />}
                <Prim.Text color={SIDEBAR_ITEM.color} fontSize={10} fontWeight="$semibold" textTransform="uppercase" letterSpacing="$wider">
                  Tasklists ({tasklistItems.length})
                </Prim.Text>
              </Prim.Pressable>
              {tasklistsExpanded && (
                <Prim.Box display="flex" flexDirection="column" gap={2}>
                  {tasklistItems.map(item => {
                    const href = `${spacePath}/workflow/${item.name}`
                    const isActive = pathname.startsWith(href)
                    return (
                      <NavLink key={item.name} to={href} {...SIDEBAR_ITEM} {...(isActive ? SIDEBAR_ITEM_ACTIVE : {})}>
                        <ListChecks />
                        <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{item.name}</Prim.Text>
                      </NavLink>
                    )
                  })}
                  <Prim.Pressable onClick={onCreateAgent} {...SIDEBAR_ITEM} opacity={0.6}>
                    <Plus {...STUDIO_SIDEBAR_CREATE_ICON} />
                    <Prim.Text fontWeight="$medium">Create Tasklist</Prim.Text>
                  </Prim.Pressable>
                </Prim.Box>
              )}
            </Prim.Box>

            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleFunctionsExpanded}
                {...SIDEBAR_ITEM}
                fontSize={10}
                fontWeight="$semibold"
                textTransform="uppercase"
                letterSpacing="$wider"
                opacity={0.7}
              >
                {functionsExpanded ? <ChevronDown {...STUDIO_SIDEBAR_SECTION_CHEVRON} /> : <ChevronRightSmall {...STUDIO_SIDEBAR_SECTION_CHEVRON} />}
                <Prim.Text color={SIDEBAR_ITEM.color} fontSize={10} fontWeight="$semibold" textTransform="uppercase" letterSpacing="$wider">
                  Functions ({functions.length})
                </Prim.Text>
              </Prim.Pressable>
              {functionsExpanded && (
                <Prim.Box display="flex" flexDirection="column" gap={2}>
                  {functions.map(name => {
                    const href = `${spacePath}/functions`
                    return (
                      <NavLink key={name} to={href} {...SIDEBAR_ITEM}>
                        <FunctionSquare {...STUDIO_SIDEBAR_ITEM_ICON_KNOWLEDGE} />
                        <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{name}</Prim.Text>
                      </NavLink>
                    )
                  })}
                  <NavLink to={`${spacePath}/functions`} {...SIDEBAR_ITEM} {...STUDIO_SIDEBAR_CREATE_BTN}>
                    <Plus {...STUDIO_SIDEBAR_CREATE_ICON} />
                    <Prim.Text fontWeight="$medium">Edit Functions</Prim.Text>
                  </NavLink>
                </Prim.Box>
              )}
            </Prim.Box>

            <Prim.Box as="section">
              <Prim.Pressable
                onClick={toggleComponentsExpanded}
                {...SIDEBAR_ITEM}
                fontSize={10}
                fontWeight="$semibold"
                textTransform="uppercase"
                letterSpacing="$wider"
                opacity={0.7}
              >
                {componentsExpanded ? <ChevronDown {...STUDIO_SIDEBAR_SECTION_CHEVRON} /> : <ChevronRightSmall {...STUDIO_SIDEBAR_SECTION_CHEVRON} />}
                <Prim.Text color={SIDEBAR_ITEM.color} fontSize={10} fontWeight="$semibold" textTransform="uppercase" letterSpacing="$wider">
                  Components ({components.length})
                </Prim.Text>
              </Prim.Pressable>
              {componentsExpanded && (
                <Prim.Box display="flex" flexDirection="column" gap={2}>
                  {components.map(c => (
                    <NavLink key={`${c.kind}/${c.name}`} to={`${spacePath}/components`} {...SIDEBAR_ITEM}>
                      <Box {...STUDIO_SIDEBAR_ITEM_ICON_KNOWLEDGE} />
                      <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{c.name}</Prim.Text>
                      <Prim.Text marginLeft="auto" opacity={0.6} fontSize={11}>{c.kind}</Prim.Text>
                    </NavLink>
                  ))}
                  <NavLink to={`${spacePath}/components`} {...SIDEBAR_ITEM} {...STUDIO_SIDEBAR_CREATE_BTN}>
                    <Plus {...STUDIO_SIDEBAR_CREATE_ICON} />
                    <Prim.Text fontWeight="$medium">Edit Components</Prim.Text>
                  </NavLink>
                </Prim.Box>
              )}
            </Prim.Box>

            {activeAgentId && (
              <Prim.Box as="section">
                <Prim.Pressable
                  onClick={toggleConversationsExpanded}
                  {...SIDEBAR_ITEM}
                  fontSize={10}
                  fontWeight="$semibold"
                  textTransform="uppercase"
                  letterSpacing="$wider"
                  opacity={0.7}
                >
                  {conversationsExpanded ? <ChevronDown {...STUDIO_SIDEBAR_SECTION_CHEVRON} /> : <ChevronRightSmall {...STUDIO_SIDEBAR_SECTION_CHEVRON} />}
                  <Prim.Text color={SIDEBAR_ITEM.color} fontSize={10} fontWeight="$semibold" textTransform="uppercase" letterSpacing="$wider">
                    Conversations (0)
                  </Prim.Text>
                </Prim.Pressable>
                {conversationsExpanded && (
                  // `Prim.Box` is an RN `View` — its `color`/`fontSize` (from `SIDEBAR_ITEM` and the
                  // `$xs` override) style the row, not this label, so both are restated below.
                  <Prim.Box {...SIDEBAR_ITEM} opacity={0.5} fontSize="$xs" cursor="default">
                    <Prim.Text color={SIDEBAR_ITEM.color} fontSize="$xs">No conversations yet.</Prim.Text>
                  </Prim.Box>
                )}
              </Prim.Box>
            )}
          </Prim.Box>
        ) : (
          <Prim.Box display="flex" flexDirection="column" alignItems="center" gap="$4">
            <Prim.Box {...SIDEBAR_ITEM} justifyContent="center" title={`${fields.length} knowledge fields`}>
              <Folder {...STUDIO_SIDEBAR_COLLAPSED_ICON_INNER} />
            </Prim.Box>
            <Prim.Box {...SIDEBAR_ITEM} justifyContent="center" title={`${agents.length} agents`}>
              <Bot {...STUDIO_SIDEBAR_COLLAPSED_ICON_INNER} />
            </Prim.Box>
          </Prim.Box>
        )}
      </Prim.Box>

      <Prim.Box padding="$3" borderTopWidth={1} borderTopColor="$border">
        <Prim.Box display="flex" flexDirection="column" gap="$1">
          {onToggleThing ? (
            <Prim.Pressable
              onClick={onToggleThing}
              {...SIDEBAR_ITEM} {...(thingOpen ? SIDEBAR_ITEM_ACTIVE : {})}
              title={thingOpen ? 'Hide THING chat' : 'Show THING chat'}
            >
              <MessageSquare {...STUDIO_SIDEBAR_FOOTER_ICON} />
              {!isCollapsed && <CozyThingText text="THING" {...STUDIO_SIDEBAR_FOOTER_LABEL} />}
            </Prim.Pressable>
          ) : (
            <NavLink to="/studio/thing" {...SIDEBAR_ITEM} {...(pathname.startsWith('/studio/thing') ? SIDEBAR_ITEM_ACTIVE : {})}>
              <Prim.Text width={20} height={20} flexShrink={0} aria-hidden="true">🤖</Prim.Text>
              {!isCollapsed && <CozyThingText text="THING" {...STUDIO_SIDEBAR_FOOTER_LABEL} />}
            </NavLink>
          )}
          <NavLink to={`${spacePath}/raw`} {...SIDEBAR_ITEM} {...(pathname.includes('/raw') ? SIDEBAR_ITEM_ACTIVE : {})}>
            <FileCode {...STUDIO_SIDEBAR_FOOTER_ICON} />
            {!isCollapsed && <Prim.Text fontSize="$sm" fontWeight="$medium">Raw Files</Prim.Text>}
          </NavLink>
          {!asRail && otherAppLinks('studio').map((link) => (
            <Prim.Link
              key={link.app}
              href={link.url}
              {...SIDEBAR_ITEM}
              title={`Open lmthing.${link.app}`}
            >
              <Prim.Text width={20} height={20} flexShrink={0} aria-hidden="true">{link.emoji}</Prim.Text>
              {!isCollapsed && <Prim.Text fontSize="$sm" fontWeight="$medium">{link.label}</Prim.Text>}
            </Prim.Link>
          ))}
          <Prim.Pressable onClick={onOpenSettings} {...SIDEBAR_ITEM}>
            <Settings {...STUDIO_SIDEBAR_FOOTER_ICON} />
            {!isCollapsed && <Prim.Text fontSize="$sm" fontWeight="$medium">Settings</Prim.Text>}
          </Prim.Pressable>
          <Prim.Pressable onClick={onToggleCollapse} {...SIDEBAR_ITEM}>
            {isCollapsed ? (
              <ChevronRight {...STUDIO_SIDEBAR_FOOTER_ICON} />
            ) : (
              <>
                <ChevronLeft {...STUDIO_SIDEBAR_FOOTER_ICON} />
                <Prim.Text fontSize="$sm" fontWeight="$medium">Collapse</Prim.Text>
              </>
            )}
          </Prim.Pressable>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

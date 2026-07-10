import '@lmthing/css/elements/nav/app-sidebar/index.css'
import * as React from 'react'
import { ChevronDown, ChevronRight, ChevronLeft, Plus, X, PanelLeft, Settings } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { CozyThingText } from '../../branding/cozy-text'

export interface AppSidebarProject {
  id: string
  name: string
}

export interface AppSidebarSpace {
  id: string
  name: string
}

export interface AppSidebarProps {
  /** Projects for the top-of-sidebar dropdown. */
  projects: AppSidebarProject[]
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  /** Optional inline project create (chat + studio can both create projects). */
  onCreateProject?: (name: string) => void | Promise<void>
  /** Optional inline project delete. */
  onDeleteProject?: (id: string) => void | Promise<void>
  /** Optional per-project settings action — renders a gear beside the project
   *  dropdown when provided. */
  onProjectSettings?: () => void

  /** Spaces belonging to the active project — the collapsible `SPACES` section. */
  spaces: AppSidebarSpace[]
  activeSpaceId?: string | null
  /** Clicking a space opens the studio view of it (surface decides local vs cross-origin). */
  onSelectSpace: (spaceId: string) => void
  spacesLoading?: boolean
  /** Whether the `SPACES` section starts expanded (per-surface). Defaults to true. */
  spacesDefaultExpanded?: boolean

  /** Chat-only `+ New chat` button (rendered under the dropdown when provided). */
  onNewChat?: () => void
  newChatBusy?: boolean
  /** Chat-only conversations content, rendered inside a collapsible `CONVERSATIONS` section. */
  conversations?: React.ReactNode

  /** Footer content (cross-app links, settings…). */
  footer?: React.ReactNode
  className?: string

  /**
   * Namespaces the persisted UI flags (section + whole-sidebar collapse) so the
   * chat and studio sidebars keep independent state. Defaults to `app-sidebar`.
   */
  storageKey?: string
  /** When false, the whole-sidebar collapse control is hidden (e.g. inside a mobile drawer). */
  collapsible?: boolean
  /** Whether the whole sidebar starts collapsed. */
  defaultCollapsed?: boolean
}

/** Boolean UI flag persisted to localStorage so collapse survives reloads. */
function usePersistentBool(key: string, initial: boolean): [boolean, () => void] {
  const [value, setValue] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return initial
    const raw = window.localStorage.getItem(key)
    return raw === null ? initial : raw === '1'
  })
  const toggle = React.useCallback(() => {
    setValue((v) => {
      const next = !v
      try {
        window.localStorage.setItem(key, next ? '1' : '0')
      } catch {
        /* ignore quota / unavailable storage */
      }
      return next
    })
  }, [key])
  return [value, toggle]
}

function SectionHeader({
  label,
  count,
  expanded,
  onToggle,
}: {
  label: string
  count?: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button onClick={onToggle} className="app-sidebar__section-header">
      {expanded ? (
        <ChevronDown className="app-sidebar__section-icon" aria-hidden="true" />
      ) : (
        <ChevronRight className="app-sidebar__section-icon" aria-hidden="true" />
      )}
      <span className="app-sidebar__section-label">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="app-sidebar__section-count">{count}</span>
      )}
    </button>
  )
}

function ProjectDropdown({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
}: Pick<
  AppSidebarProps,
  'projects' | 'activeProjectId' | 'onSelectProject' | 'onCreateProject' | 'onDeleteProject'
>) {
  const [open, setOpen] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const active = projects.find((p) => p.id === activeProjectId)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const create = async () => {
    const name = newName.trim()
    if (!name || !onCreateProject) return
    setCreating(true)
    try {
      await onCreateProject(name)
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={ref} className="app-sidebar__dropdown">
      <button
        onClick={() => setOpen((v) => !v)}
        className="app-sidebar__dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="app-sidebar__dropdown-label">
          {active ? active.name || active.id : 'Select project'}
        </span>
        <ChevronDown className="app-sidebar__dropdown-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="app-sidebar__dropdown-menu">
          <div className="app-sidebar__dropdown-list">
            {projects.map((p) => (
              <div key={p.id} className="app-sidebar__dropdown-row">
                <button
                  onClick={() => {
                    onSelectProject(p.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'app-sidebar__dropdown-item',
                    p.id === activeProjectId && 'app-sidebar__dropdown-item--active',
                  )}
                >
                  {p.name || p.id}
                </button>
                {onDeleteProject && p.id !== activeProjectId && (
                  <button
                    onClick={() => void onDeleteProject(p.id)}
                    className="app-sidebar__dropdown-delete"
                    title="Delete project"
                  >
                    <X className="app-sidebar__icon" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {onCreateProject && (
            <div className="app-sidebar__dropdown-create">
              <input
                className="app-sidebar__dropdown-input"
                placeholder="New project…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
              />
              <button
                onClick={() => void create()}
                disabled={creating || !newName.trim()}
                className="app-sidebar__dropdown-add"
                title="Create project"
              >
                <Plus className="app-sidebar__icon" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The shared left navigation used by both the chat and studio surfaces. It is
 * purely presentational — each surface passes its own project/space data and
 * navigation callbacks. The `CONVERSATIONS` section only appears when the chat
 * surface supplies a `conversations` node. The whole sidebar collapses to a slim
 * icon rail via the header toggle.
 */
export function AppSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onProjectSettings,
  spaces,
  activeSpaceId,
  onSelectSpace,
  spacesLoading,
  spacesDefaultExpanded = true,
  onNewChat,
  newChatBusy,
  conversations,
  footer,
  className,
  storageKey = 'app-sidebar',
  collapsible = true,
  defaultCollapsed = false,
}: AppSidebarProps) {
  const [spacesExpanded, toggleSpaces] = usePersistentBool(
    `${storageKey}.spaces.expanded`,
    spacesDefaultExpanded,
  )
  const [convExpanded, toggleConv] = usePersistentBool(`${storageKey}.conversations.expanded`, true)
  const [collapsed, toggleCollapsed] = usePersistentBool(`${storageKey}.collapsed`, defaultCollapsed)
  const isCollapsed = collapsible && collapsed

  // Collapsed: a slim rail with just an expand affordance.
  if (isCollapsed) {
    return (
      <nav aria-label="sidebar (collapsed)" className={cn('app-sidebar app-sidebar--collapsed', className)}>
        <div className="app-sidebar__rail">
          <CozyThingText text="lmt" className="app-sidebar__rail-brand" />
          <button
            onClick={toggleCollapsed}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="app-sidebar__rail-btn"
          >
            <PanelLeft className="app-sidebar__section-icon" aria-hidden="true" />
          </button>
        </div>
      </nav>
    )
  }

  return (
    <nav
      aria-label="projects, spaces and conversations"
      className={cn('app-sidebar', collapsible && 'app-sidebar--fixed', className)}
    >
      {/* Brand + collapse toggle */}
      <div className="app-sidebar__header">
        <CozyThingText text="lmthing" className="app-sidebar__brand" />
        {collapsible && (
          <button
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="app-sidebar__collapse-btn"
          >
            <ChevronLeft className="app-sidebar__section-icon" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Project dropdown (+ optional project settings) + optional new chat */}
      <div className="app-sidebar__top">
        <div className="app-sidebar__project-row">
          <ProjectDropdown
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={onSelectProject}
            onCreateProject={onCreateProject}
            onDeleteProject={onDeleteProject}
          />
          {onProjectSettings && activeProjectId && (
            <button
              onClick={onProjectSettings}
              className="app-sidebar__project-settings"
              title="Project settings"
              aria-label="Project settings"
            >
              <Settings className="app-sidebar__section-icon" aria-hidden="true" />
            </button>
          )}
        </div>
        {onNewChat && (
          <button
            onClick={onNewChat}
            disabled={!activeProjectId || newChatBusy}
            className="app-sidebar__new-chat"
          >
            {newChatBusy ? '…' : '+ New chat'}
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="app-sidebar__content">
        {/* Spaces */}
        <div className="app-sidebar__section">
          <SectionHeader
            label="Spaces"
            count={spaces.length}
            expanded={spacesExpanded}
            onToggle={toggleSpaces}
          />
          {spacesExpanded && (
            <div className="app-sidebar__section-body">
              {spacesLoading && spaces.length === 0 ? (
                <p className="app-sidebar__empty">Loading…</p>
              ) : spaces.length === 0 ? (
                <p className="app-sidebar__empty">No spaces yet.</p>
              ) : (
                spaces.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectSpace(s.id)}
                    className={cn(
                      'app-sidebar__item',
                      s.id === activeSpaceId && 'app-sidebar__item--active',
                    )}
                    title={s.name}
                  >
                    {s.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Conversations (chat only) */}
        {conversations !== undefined && (
          <div className="app-sidebar__section">
            <SectionHeader label="Conversations" expanded={convExpanded} onToggle={toggleConv} />
            {convExpanded && <div className="app-sidebar__section-body">{conversations}</div>}
          </div>
        )}
      </div>

      {/* Footer */}
      {footer && <div className="app-sidebar__footer">{footer}</div>}
    </nav>
  )
}

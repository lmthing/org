import * as React from 'react'
import { ChevronDown, ChevronRight, ChevronLeft, Plus, X, PanelLeft } from 'lucide-react'
import { cn } from '../../../lib/utils'

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
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1 px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
    >
      {expanded ? (
        <ChevronDown className="w-3 h-3 shrink-0" aria-hidden="true" />
      ) : (
        <ChevronRight className="w-3 h-3 shrink-0" aria-hidden="true" />
      )}
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-muted-foreground/60 font-normal">{count}</span>
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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/70 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 text-left truncate">{active?.name ?? 'Select project'}</span>
        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {projects.map((p) => (
              <div key={p.id} className="group flex items-center gap-1 px-1">
                <button
                  onClick={() => {
                    onSelectProject(p.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex-1 text-left px-2 py-1.5 rounded-lg text-sm truncate transition-colors',
                    p.id === activeProjectId
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  {p.name}
                </button>
                {onDeleteProject && p.id !== activeProjectId && (
                  <button
                    onClick={() => void onDeleteProject(p.id)}
                    className="hidden group-hover:flex w-5 h-5 items-center justify-center text-muted-foreground hover:text-destructive rounded text-xs shrink-0"
                    title="Delete project"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {onCreateProject && (
            <div className="flex gap-1 border-t border-border px-2 py-2">
              <input
                className="flex-1 min-w-0 bg-muted rounded-lg px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="px-2 py-1 bg-muted text-foreground rounded-lg text-xs hover:opacity-90 disabled:opacity-40"
                title="Create project"
              >
                <Plus className="w-3 h-3" />
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

  const baseClass =
    'flex flex-col h-full bg-sidebar border-r border-sidebar-border overflow-hidden transition-all duration-200'

  // Collapsed: a slim rail with just an expand affordance.
  if (isCollapsed) {
    return (
      <nav aria-label="sidebar (collapsed)" className={cn(baseClass, 'w-12', className)}>
        <div className="flex flex-col items-center py-3 gap-2">
          <button
            onClick={toggleCollapsed}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <PanelLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </nav>
    )
  }

  return (
    <nav
      aria-label="projects, spaces and conversations"
      className={cn(baseClass, collapsible && 'w-64', className)}
    >
      {/* Brand + collapse toggle */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-sidebar-border shrink-0">
        <span className="font-display font-bold text-base text-foreground">THING</span>
        <span className="text-xs text-muted-foreground">by lmthing</span>
        {collapsible && (
          <button
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="ml-auto w-6 h-6 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Project dropdown + optional new chat */}
      <div className="px-3 py-2 flex flex-col gap-2 shrink-0">
        <ProjectDropdown
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
          onDeleteProject={onDeleteProject}
        />
        {onNewChat && (
          <button
            onClick={onNewChat}
            disabled={!activeProjectId || newChatBusy}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {newChatBusy ? '…' : '+ New chat'}
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {/* Spaces */}
        <div className="mb-3">
          <SectionHeader
            label="Spaces"
            count={spaces.length}
            expanded={spacesExpanded}
            onToggle={toggleSpaces}
          />
          {spacesExpanded && (
            <div className="mt-0.5">
              {spacesLoading && spaces.length === 0 ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">Loading…</p>
              ) : spaces.length === 0 ? (
                <p className="px-2 py-1 text-sm text-muted-foreground">No spaces yet.</p>
              ) : (
                spaces.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectSpace(s.id)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded-lg text-sm truncate transition-colors',
                      s.id === activeSpaceId
                        ? 'bg-muted text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
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
          <div className="mb-3">
            <SectionHeader label="Conversations" expanded={convExpanded} onToggle={toggleConv} />
            {convExpanded && <div className="mt-0.5">{conversations}</div>}
          </div>
        )}
      </div>

      {/* Footer */}
      {footer && <div className="shrink-0 border-t border-sidebar-border">{footer}</div>}
    </nav>
  )
}

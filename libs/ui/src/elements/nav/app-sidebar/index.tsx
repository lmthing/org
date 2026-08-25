import * as React from 'react'
// `@tamagui/lucide-icons`, not `lucide-react`: the latter renders literal DOM `<svg>`/`<path>`
// elements, which React Native has no host component for — `TurboModuleRegistry`/view-config
// resolution throws the moment one mounts. `@tamagui/lucide-icons` wraps the same icon set in
// `react-native-svg`'s `Svg`/`Path`, which both targets can render.
import { ChevronDown, ChevronRight, ChevronLeft, Plus, X, PanelLeft, Settings } from '../../primitives/icons'
import * as Prim from '../../primitives/index'
import { CozyThingText } from '../../branding/cozy-text'

/**
 * `.app-sidebar*` as `$`-token PROPS (docs/tamagui-idiomatic-migration.md §4/§6).
 * `app-sidebar/index.css` — the last `elements/**` stylesheet — is deleted.
 *
 * Three rules were CSS-shaped and are now expressed directly:
 *
 * - `.app-sidebar__project-row .app-sidebar__dropdown` (a descendant combinator that stretched the
 *   dropdown inside its row) becomes props passed at that one call site.
 * - `.app-sidebar__dropdown-row:hover .app-sidebar__dropdown-delete` — the stylesheet's own comment
 *   called it "a BEM alternative to `group-hover`" — becomes exactly that: Tamagui `group="row"` on
 *   the row and `$group-row-hover` on the delete button.
 * - `text-muted-foreground/60` becomes a web `color-mix`, the same alpha treatment used elsewhere.
 *
 * The brand marks name NO font family — `CozyThingText` owns that (`$brand`). Every
 * `transition-colors`/`transition-opacity` had no animation to preserve.
 */
const SIDEBAR_SHELL = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: '$sidebar',
  borderRightWidth: 1,
  borderRightColor: '$sidebar-border',
  overflow: 'hidden',
} as const

/** `.app-sidebar--fixed` — w-64 when the surface owns sizing. */
const SHELL_FIXED = { width: '$64' } as const
/** `.app-sidebar--collapsed` — the slim icon rail. */
const SHELL_COLLAPSED = { width: '$12' } as const

/** A muted icon button that hovers onto muted/60 — the rail, collapse and settings affordances. */
const ICON_BTN = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$radius-lg',
  color: '$muted-foreground',
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  hoverStyle: {
    backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)',
    color: '$foreground',
  },
} as const

const RAIL = { display: 'flex', flexDirection: 'column', alignItems: 'center', paddingVertical: '$3', gap: '$2' } as const
const RAIL_BTN = { ...ICON_BTN, width: '$8', height: '$8' } as const
// NO `fontFamily` HERE. `CozyThingText` defaults to `$brand` (the wordmark's own face) and spreads
// caller props AFTER that default, so naming a family here silently overrides the mark. This used to
// say `fontFamily: '$heading'`, which was harmless only while `$heading` WAS the wordmark face — the
// moment `--font-display` moved to the UI face, the sidebar logo rendered in Manrope while every
// other surface rendered it in Cera, with the right colours, so it read as a subtle weight change
// rather than a bug.
const BRAND = { fontWeight: '$bold', fontSize: '$base' } as const
// 16 = the `$base` font size, i.e. "no extra leading". NOT `1`: Tamagui appends `px`, so a ratio
// becomes a 1px line box. See lineHeight.test.tsx.
const RAIL_BRAND = { ...BRAND, lineHeight: 16 } as const

const HEADER = {
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$4',
  paddingVertical: '$3',
  borderBottomWidth: 1,
  borderBottomColor: '$sidebar-border',
  flexShrink: 0,
} as const
const COLLAPSE_BTN = { ...ICON_BTN, marginLeft: 'auto', width: '$6', height: '$6' } as const

const TOP = { paddingHorizontal: '$3', paddingVertical: '$2', display: 'flex', flexDirection: 'column', gap: '$2', flexShrink: 0 } as const
const PROJECT_ROW = { display: 'flex', alignItems: 'center', gap: '$1' } as const
/** The descendant rule `.app-sidebar__project-row .app-sidebar__dropdown` — applied at the call site. */
const PROJECT_ROW_DROPDOWN = { flexGrow: 1, flexShrink: 1, flexBasis: '0%', minWidth: 0 } as const
const PROJECT_SETTINGS = { ...ICON_BTN, flexShrink: 0, width: '$8', height: '$8' } as const

const NEW_CHAT = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderRadius: '$radius-xl',
  backgroundColor: '$primary',
  color: '$primary-foreground',
  fontSize: '$sm',
  fontWeight: '$medium',
  borderWidth: 0,
  cursor: 'pointer',
  hoverStyle: { opacity: 0.9 },
  disabledStyle: { opacity: 0.5 },
} as const

const CONTENT = { flexGrow: 1, flexShrink: 1, flexBasis: '0%', overflow: 'auto', paddingHorizontal: '$2', paddingVertical: '$1' } as const
const SECTION = { marginBottom: '$3' } as const
const SECTION_BODY = { marginTop: '$0.5' } as const
const EMPTY = { paddingHorizontal: '$2', paddingVertical: '$1', fontSize: '$sm', color: '$muted-foreground' } as const

/** `.app-sidebar__item` — a truncating, full-width row. */
const ITEM = {
  width: '100%',
  textAlign: 'left',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
  borderRadius: '$radius-lg',
  fontSize: '$sm',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '$muted-foreground',
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  hoverStyle: {
    backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)',
    color: '$foreground',
  },
} as const
const ITEM_ACTIVE = { backgroundColor: '$muted', color: '$foreground', fontWeight: '$medium' } as const
/**
 * `ITEM` as an anchor. `Prim.Link` is a TEXT leaf — `display: inline` by default and underlined by
 * the UA — so `ITEM`'s row shape (full width, one truncating line) does not hold until it is given
 * a display of its own. `flex`, NOT `block`: React Native accepts only `flex`/`none`/`contents`, so
 * `block` would reach Yoga as garbage on the phone (see `primitives/_native.tsx#nativeSafeProps`),
 * and `flex` is the one value that means the same thing on both targets. The label goes in a child
 * `Text` because the ellipsis belongs to the text box, not to the flex container.
 */
const ITEM_LINK = { ...ITEM, display: 'flex', alignItems: 'center', textDecorationLine: 'none' } as const
/** The label inside `ITEM_LINK` — a flex item, so it is blockified and can actually ellipsize. */
const ITEM_LINK_LABEL = {
  flexGrow: 1, flexShrink: 1, flexBasis: '0%',
  minWidth: 0,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
} as const

const FOOTER = { flexShrink: 0, borderTopWidth: 1, borderTopColor: '$sidebar-border' } as const

const SECTION_HEADER = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  fontSize: '$xs',
  fontWeight: '$semibold',
  color: '$muted-foreground',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  hoverStyle: { color: '$foreground' },
} as const
const SECTION_LABEL = { flexGrow: 1, flexShrink: 1, flexBasis: '0%', textAlign: 'left' } as const
const SECTION_COUNT = {
  color: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
  fontWeight: '$normal',
} as const

/** `.app-sidebar__section-icon` / `__icon` — lucide SVGs, so a plain style. */
// `@tamagui/lucide-icons` sizes itself via a `size` PROP, not a style width/height (its `Svg` root
// sets `width`/`height` from `size` before spreading the rest of its props) — so the visual size
// moved out of these `style` objects into `*_SIZE` below; `flexShrink` stays here, a real layout
// concern the icon's own props don't touch.
const SECTION_ICON_SIZE = 12
const SECTION_ICON_FLEX_STYLE = { flexShrink: 0 } as const
const ICON_SIZE = 12
const CHEVRON_SIZE = 16
const CHEVRON_FLEX_STYLE = { flexShrink: 0 } as const

const DROPDOWN = { position: 'relative' } as const
const DROPDOWN_TRIGGER = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderRadius: '$radius-xl',
  backgroundColor: '$muted',
  color: '$foreground',
  fontSize: '$sm',
  fontWeight: '$medium',
  borderWidth: 0,
  cursor: 'pointer',
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 70%, transparent)' },
} as const
const DROPDOWN_LABEL = {
  flexGrow: 1, flexShrink: 1, flexBasis: '0%',
  textAlign: 'left',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
} as const
const DROPDOWN_MENU = {
  position: 'absolute',
  left: 0, right: 0, top: '100%',
  marginTop: '$1',
  zIndex: 20,
  borderRadius: '$radius-xl',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$popover',
  overflow: 'hidden',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 10 },
  shadowRadius: 15,
} as const
const DROPDOWN_LIST = { maxHeight: '$64', overflow: 'auto', paddingVertical: '$1' } as const
/** The row is the hover GROUP that reveals its delete button. */
const DROPDOWN_ROW = { display: 'flex', alignItems: 'center', gap: '$1', paddingHorizontal: '$1' } as const
const DROPDOWN_ITEM = { ...ITEM, flexGrow: 1, flexShrink: 1, flexBasis: '0%', width: undefined } as const
const DROPDOWN_ITEM_ACTIVE = ITEM_ACTIVE
/** `hidden!` until the row is hovered — the group-hover reveal. */
const DROPDOWN_DELETE = {
  display: 'none',
  '$group-row-hover': { display: 'flex' },
  width: '$5',
  height: '$5',
  alignItems: 'center',
  justifyContent: 'center',
  color: '$muted-foreground',
  borderRadius: '$radius',
  fontSize: '$xs',
  flexShrink: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  hoverStyle: { color: '$destructive' },
} as const
const DROPDOWN_CREATE = {
  display: 'flex',
  gap: '$1',
  borderTopWidth: 1,
  borderTopColor: '$border',
  paddingHorizontal: '$2',
  paddingVertical: '$2',
} as const
const DROPDOWN_INPUT = {
  flexGrow: 1, flexShrink: 1, flexBasis: '0%',
  minWidth: 0,
  backgroundColor: '$muted',
  borderRadius: '$radius-lg',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  fontSize: '$xs',
  color: '$foreground',
  borderWidth: 0,
  placeholderTextColor: '$muted-foreground',
  focusStyle: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: '$ring' },
} as const
const DROPDOWN_ADD = {
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  backgroundColor: '$muted',
  color: '$foreground',
  borderRadius: '$radius-lg',
  fontSize: '$xs',
  borderWidth: 0,
  cursor: 'pointer',
  hoverStyle: { opacity: 0.9 },
  disabledStyle: { opacity: 0.4 },
} as const

export interface AppSidebarProject {
  id: string
  name: string
}

export interface AppSidebarSpace {
  id: string
  name: string
}

/**
 * One openable page of the active project's application — see `org/docs/app/`.
 *
 * The surface resolves both the label and the URL (the served mount differs per host, and only
 * the surface knows which project is selected); the sidebar just renders links.
 */
export interface AppSidebarPage {
  /** The manifest route — `/`, `/trips`, `/settings/profile`. Identity of the row. */
  routePath: string
  /** What the row reads as (`/settings/profile` → `Settings / Profile`). */
  label: string
  /** Where the page is served — `projectAppUrl(projectId, routePath)`. */
  href: string
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

  /**
   * The active project's app pages — the collapsible `APP` section, rendered ONLY when the
   * project has an application with openable pages. An absent/empty list is not an empty state
   * to explain: most projects are not applications, and a permanent "no app" row would be noise
   * in the one place the reader scans for their conversations.
   */
  appPages?: AppSidebarPage[]

  /**
   * How to open one of `appPages` — the seam that lets the SAME section behave differently per host.
   *
   * Absent (the web/default): each row is a real anchor to the pod's `/app/<project>/<route>` mount,
   * opened in a new tab (`target="_blank"` / `Linking.openURL`), because the app is another mount and
   * opening it must not take the reader's live chat with it.
   *
   * Present (the mobile host): the row calls this instead, and the host renders the page NATIVELY
   * through `@lmthing/ui/view` — no WebView, no lost chat socket. The host owns the screen because
   * native has no URL to hold the open page in.
   */
  onOpenAppPage?: (routePath: string) => void

  /** Chat-only `+ New chat` button (rendered under the dropdown when provided). */
  onNewChat?: () => void
  newChatBusy?: boolean
  /** Chat-only conversations content, rendered inside a collapsible `CONVERSATIONS` section. */
  conversations?: React.ReactNode

  /** Footer content (cross-app links, settings…). */
  footer?: React.ReactNode
  className?: string

  /**
   * `flex-shrink` for the sidebar shell. A surface that places the sidebar in a flex ROW wants `0`,
   * so a wide main pane cannot compress it. Declared as a real prop because the studio surfaces used
   * to pass `className="shrink-0"` — a Tailwind utility, and there is no Tailwind after phase 4.
   * Left undefined by default so chat's sidebar keeps the shell's own value.
   */
  flexShrink?: number

  /**
   * Shell width/height overrides. The mobile DRAWER needs `width: '100%'` — it renders with
   * `collapsible={false}`, so `SHELL_FIXED` is not applied and the shell has no width of its own.
   * Spread AFTER `SHELL_FIXED` so an explicit value wins.
   */
  width?: number | string
  height?: number | string

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
    const raw = globalThis.window?.localStorage?.getItem(key) ?? null
    return raw === null ? initial : raw === '1'
  })
  const toggle = React.useCallback(() => {
    setValue((v) => {
      const next = !v
      try {
        globalThis.window?.localStorage?.setItem(key, next ? '1' : '0')
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
    <Prim.Pressable onClick={onToggle} {...SECTION_HEADER}>
      {expanded ? (
        <ChevronDown size={SECTION_ICON_SIZE} style={SECTION_ICON_FLEX_STYLE} aria-hidden={true} />
      ) : (
        <ChevronRight size={SECTION_ICON_SIZE} style={SECTION_ICON_FLEX_STYLE} aria-hidden={true} />
      )}
      <Prim.Text {...SECTION_LABEL}>{label}</Prim.Text>
      {count !== undefined && count > 0 && (
        <Prim.Text {...SECTION_COUNT}>{count}</Prim.Text>
      )}
    </Prim.Pressable>
  )
}

export function ProjectDropdown({
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
    // Click-outside is a pointer concept the web owns. On native the overlay primitives dismiss
    // themselves (RN `Modal` + a backdrop press), so there is nothing to bind here.
    globalThis.document?.addEventListener('mousedown', onDown)
    return () => globalThis.document?.removeEventListener('mousedown', onDown)
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
    <Prim.Box ref={ref as React.Ref<HTMLElement>} {...DROPDOWN} {...PROJECT_ROW_DROPDOWN}>
      <Prim.Pressable
        onClick={() => setOpen((v) => !v)}
        {...DROPDOWN_TRIGGER}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Prim.Text {...DROPDOWN_LABEL}>
          {active ? active.name || active.id : 'Select project'}
        </Prim.Text>
        <ChevronDown size={CHEVRON_SIZE} style={CHEVRON_FLEX_STYLE} aria-hidden={true} />
      </Prim.Pressable>

      {open && (
        <Prim.Box {...DROPDOWN_MENU}>
          <Prim.Box {...DROPDOWN_LIST}>
            {projects.map((p) => (
              <Prim.Box key={p.id} {...DROPDOWN_ROW} {...({ group: 'row' } as Record<string, unknown>)}>
                <Prim.Pressable
                  onClick={() => {
                    onSelectProject(p.id)
                    setOpen(false)
                  }}
                  {...DROPDOWN_ITEM}
                  {...(p.id === activeProjectId ? DROPDOWN_ITEM_ACTIVE : {})}
                >
                  <Prim.Text>{p.name || p.id}</Prim.Text>
                </Prim.Pressable>
                {onDeleteProject && p.id !== activeProjectId && (
                  <Prim.Pressable
                    onClick={() => void onDeleteProject(p.id)}
                    {...DROPDOWN_DELETE}
                    title="Delete project"
                  >
                    <X size={ICON_SIZE} />
                  </Prim.Pressable>
                )}
              </Prim.Box>
            ))}
          </Prim.Box>
          {onCreateProject && (
            <Prim.Box {...DROPDOWN_CREATE}>
              <Prim.TextField
                {...DROPDOWN_INPUT}
                placeholder="New project…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                }}
              />
              <Prim.Pressable
                onClick={() => void create()}
                disabled={creating || !newName.trim()}
                {...DROPDOWN_ADD}
                title="Create project"
              >
                <Plus size={ICON_SIZE} />
              </Prim.Pressable>
            </Prim.Box>
          )}
        </Prim.Box>
      )}
    </Prim.Box>
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
  appPages,
  onOpenAppPage,
  onNewChat,
  newChatBusy,
  conversations,
  footer,
  className,
  flexShrink,
  width,
  height,
  storageKey = 'app-sidebar',
  collapsible = true,
  defaultCollapsed = false,
}: AppSidebarProps) {
  const [spacesExpanded, toggleSpaces] = usePersistentBool(
    `${storageKey}.spaces.expanded`,
    spacesDefaultExpanded,
  )
  const [convExpanded, toggleConv] = usePersistentBool(`${storageKey}.conversations.expanded`, true)
  const [appExpanded, toggleApp] = usePersistentBool(`${storageKey}.app.expanded`, true)
  const [collapsed, toggleCollapsed] = usePersistentBool(`${storageKey}.collapsed`, defaultCollapsed)
  const isCollapsed = collapsible && collapsed

  // Collapsed: a slim rail with just an expand affordance.
  if (isCollapsed) {
    return (
      <Prim.Box as="nav" aria-label="sidebar (collapsed)" {...SIDEBAR_SHELL} {...SHELL_COLLAPSED} flexShrink={flexShrink} {...(width !== undefined ? { width } : {})} {...(height !== undefined ? { height } : {})} className={className}>
        <Prim.Box {...RAIL}>
          <CozyThingText text="lmt" {...RAIL_BRAND} />
          <Prim.Pressable
            onClick={toggleCollapsed}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            {...RAIL_BTN}
          >
            <PanelLeft size={SECTION_ICON_SIZE} style={SECTION_ICON_FLEX_STYLE} aria-hidden={true} />
          </Prim.Pressable>
        </Prim.Box>
      </Prim.Box>
    )
  }

  return (
    <Prim.Box
      as="nav"
      aria-label="projects, spaces and conversations"
      {...SIDEBAR_SHELL}
      {...(collapsible ? SHELL_FIXED : {})}
      flexShrink={flexShrink}
      {...(width !== undefined ? { width } : {})}
      {...(height !== undefined ? { height } : {})}
      className={className}
    >
      {/* Brand + collapse toggle */}
      <Prim.Box {...HEADER}>
        <CozyThingText text="lmthing" {...BRAND} />
        {collapsible && (
          <Prim.Pressable
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            {...COLLAPSE_BTN}
          >
            <ChevronLeft size={SECTION_ICON_SIZE} style={SECTION_ICON_FLEX_STYLE} aria-hidden={true} />
          </Prim.Pressable>
        )}
      </Prim.Box>

      {/* Project dropdown (+ optional project settings) + optional new chat */}
      <Prim.Box {...TOP}>
        <Prim.Box {...PROJECT_ROW}>
          <ProjectDropdown
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={onSelectProject}
            onCreateProject={onCreateProject}
            onDeleteProject={onDeleteProject}
          />
          {onProjectSettings && activeProjectId && (
            <Prim.Pressable
              onClick={onProjectSettings}
              {...PROJECT_SETTINGS}
              title="Project settings"
              aria-label="Project settings"
            >
              <Settings size={SECTION_ICON_SIZE} style={SECTION_ICON_FLEX_STYLE} aria-hidden={true} />
            </Prim.Pressable>
          )}
        </Prim.Box>
        {onNewChat && (
          <Prim.Pressable
            onClick={onNewChat}
            disabled={!activeProjectId || newChatBusy}
            {...NEW_CHAT}
          >
            <Prim.Text>{newChatBusy ? '…' : '+ New chat'}</Prim.Text>
          </Prim.Pressable>
        )}
      </Prim.Box>

      {/* Scrollable content */}
      <Prim.Box {...CONTENT}>
        {/* App pages — only when the active project IS an application. Above `Spaces` because it
            is the one section that leaves the surface for the thing the project actually is. */}
        {appPages && appPages.length > 0 && (
          <Prim.Box {...SECTION} data-testid="sidebar-app-pages">
            <SectionHeader
              label="App"
              count={appPages.length}
              expanded={appExpanded}
              onToggle={toggleApp}
            />
            {appExpanded && (
              <Prim.Box {...SECTION_BODY}>
                {appPages.map((p) =>
                  onOpenAppPage ? (
                    // A host that can render the page NATIVELY (mobile) takes the route and owns the
                    // screen — no anchor, no WebView, and the live chat stays mounted underneath.
                    // A `Pressable`, not a `Link`, so nothing navigates the surface away.
                    <Prim.Pressable
                      key={p.routePath}
                      onClick={() => onOpenAppPage(p.routePath)}
                      data-route={p.routePath}
                      {...ITEM_LINK}
                      title={`Open ${p.routePath}`}
                    >
                      <Prim.Text {...ITEM_LINK_LABEL}>{p.label}</Prim.Text>
                    </Prim.Pressable>
                  ) : (
                    // The default: a real anchor, not a `Pressable` + navigate. The app is served
                    // from another mount (`/app/<project>/…`) and opening it must not take the
                    // reader's chat with it — `target="_blank"` on web.
                    <Prim.Link
                      key={p.routePath}
                      href={p.href}
                      target="_blank"
                      rel="noreferrer"
                      data-route={p.routePath}
                      {...ITEM_LINK}
                      title={`Open ${p.routePath}`}
                    >
                      <Prim.Text {...ITEM_LINK_LABEL}>{p.label}</Prim.Text>
                    </Prim.Link>
                  ),
                )}
              </Prim.Box>
            )}
          </Prim.Box>
        )}

        {/* Spaces */}
        <Prim.Box {...SECTION}>
          <SectionHeader
            label="Spaces"
            count={spaces.length}
            expanded={spacesExpanded}
            onToggle={toggleSpaces}
          />
          {spacesExpanded && (
            <Prim.Box {...SECTION_BODY}>
              {spacesLoading && spaces.length === 0 ? (
                <Prim.Text as="p" {...EMPTY}>Loading…</Prim.Text>
              ) : spaces.length === 0 ? (
                <Prim.Text as="p" {...EMPTY}>No spaces yet.</Prim.Text>
              ) : (
                spaces.map((s) => (
                  <Prim.Pressable
                    key={s.id}
                    onClick={() => onSelectSpace(s.id)}
                    {...ITEM}
                    {...(s.id === activeSpaceId ? ITEM_ACTIVE : {})}
                    title={s.name}
                  >
                    <Prim.Text>{s.name}</Prim.Text>
                  </Prim.Pressable>
                ))
              )}
            </Prim.Box>
          )}
        </Prim.Box>

        {/* Conversations (chat only) */}
        {conversations !== undefined && (
          <Prim.Box {...SECTION}>
            <SectionHeader label="Conversations" expanded={convExpanded} onToggle={toggleConv} />
            {convExpanded && <Prim.Box {...SECTION_BODY}>{conversations}</Prim.Box>}
          </Prim.Box>
        )}
      </Prim.Box>

      {/* Footer */}
      {footer && <Prim.Box {...FOOTER}>{footer}</Prim.Box>}
    </Prim.Box>
  )
}

/**
 * The prop bags above, grouped for the test suite. `app-sidebar` is the largest element in the
 * layer and cannot be rendered under this vitest config (its project dropdown pulls in
 * `@lmthing/state`, which resolves a second copy of React), so `index.test.tsx` asserts the
 * translated VALUES directly — the same thing the deleted `app-sidebar-styled.test.tsx` did for
 * the parallel `styled()` copy, but against the bags the shipped component actually spreads.
 * See docs/tamagui-idiomatic-migration.md §4/§6.
 */
export const __styles = {
  SIDEBAR_SHELL, SHELL_FIXED, SHELL_COLLAPSED, ICON_BTN, RAIL, RAIL_BTN, BRAND, RAIL_BRAND,
  HEADER, COLLAPSE_BTN, TOP, PROJECT_ROW, PROJECT_ROW_DROPDOWN, PROJECT_SETTINGS, NEW_CHAT,
  CONTENT, SECTION, SECTION_BODY, EMPTY, ITEM, ITEM_ACTIVE, ITEM_LINK, ITEM_LINK_LABEL, FOOTER, SECTION_HEADER, SECTION_LABEL,
  SECTION_COUNT, DROPDOWN, DROPDOWN_TRIGGER, DROPDOWN_MENU, DROPDOWN_LIST, DROPDOWN_ROW,
  DROPDOWN_ITEM, DROPDOWN_ITEM_ACTIVE, DROPDOWN_DELETE, DROPDOWN_CREATE,
} as const

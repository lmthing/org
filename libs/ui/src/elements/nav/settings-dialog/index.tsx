import * as React from 'react'
import * as Prim from '../../primitives/index'
import { User, Cpu, Terminal, CreditCard, GitBranch, Webhook, Share2, Zap, type LucideIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../overlays/dialog'
import { Heading } from '../../typography/heading'
import { Caption } from '../../typography/caption'
import { Account } from '../../settings/account'
import { Models } from '../../settings/models'
import { EnvVars } from '../../settings/env-vars'
import { Billing } from '../../settings/billing'
import { WorkspaceBackup } from '../../settings/backup'
import { Triggers } from '../../settings/triggers'
import { Sessions } from '../../settings/sessions'
import { Hooks } from '../../settings/hooks'

interface TabDef {
  id: string
  label: string
  icon: LucideIcon
  title: string
  description?: string
  render: () => React.ReactNode
}


/**
 * `.settings-dialog*` as `$`-token PROPS (docs/tamagui-idiomatic-migration.md §4/§6).
 * `settings-dialog/index.css` is deleted.
 *
 * Two CSS-shaped things become plain props here:
 *
 * - The stylesheet used a COMPOUND selector, `.dialog.settings-dialog`, purely to out-specify the
 *   base `.dialog` width cap regardless of stylesheet order. With the dialog on props that hack is
 *   unnecessary: `DialogContent` spreads `DIALOG_BASE` and then the caller's props, so passing
 *   `maxWidth`/`maxHeight` here simply wins by spread order.
 * - The `@media (max-width: 640px)` block becomes Tamagui MEDIA PROPS. The generated media config
 *   is Tailwind's, which is min-width/mobile-first, so the query inverts: the narrow layout becomes
 *   the BASE and `$gtXs` (min-width 640) restores the wide one.
 */
const PANEL_SIZE = { maxWidth: 'min(96vw, 72rem)', maxHeight: '88vh' } as const

/** `.settings-dialog__body` — a column on narrow, a gap-6 row from 640px up. */
const BODY = {
  display: 'flex',
  flexDirection: 'column',
  gap: '$3',
  minHeight: 0,
  $gtXs: { flexDirection: 'row', gap: '$6' },
} as const

/** `.settings-dialog__tabs` — a wrapping top bar on narrow, a fixed left rail from 640px up. */
const TABS_RAIL = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: '$1',
  flexShrink: 0,
  width: '100%',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  paddingBottom: '$3',
  $gtXs: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
    width: '$48',
    borderBottomWidth: 0,
    paddingBottom: 0,
    borderRightWidth: 1,
    borderRightColor: '$border',
    paddingRight: '$3',
  },
} as const

/** `.settings-dialog__tab`. */
const TAB = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderRadius: '$radius-lg',
  fontSize: '$sm',
  textAlign: 'left',
  color: '$muted-foreground',
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  hoverStyle: {
    backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)', // hover:bg-muted/60
    color: '$foreground',
  },
} as const

/** `.settings-dialog__tab--active`. */
const TAB_ACTIVE = { backgroundColor: '$muted', color: '$foreground', fontWeight: '$medium' } as const

/** `.settings-dialog__panel` — the independently scrolling right pane. */
const PANEL = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
  overflow: 'auto',
  paddingRight: '$1',
  maxHeight: '74vh',
} as const

/** `.settings-dialog__section`. */
const SECTION = { display: 'flex', flexDirection: 'column', gap: '$2' } as const

/** `.settings-dialog__tab-icon` — w-4 h-4 shrink-0. Stays a style: the icon is a lucide SVG. */
const TAB_ICON_STYLE = { width: 16, height: 16, flexShrink: 0 } as const

const TABS: TabDef[] = [
  {
    id: 'account',
    label: 'Account',
    icon: User,
    title: 'Account',
    render: () => <Account />,
  },
  {
    id: 'models',
    label: 'Models',
    icon: Cpu,
    title: 'Models',
    description: 'Map short aliases to full model specs and pick your default.',
    render: () => <Models />,
  },
  {
    id: 'env',
    label: 'Environment',
    icon: Terminal,
    title: 'Environment Variables',
    description: 'Injected into your compute pod at startup. Saving restarts your pod.',
    render: () => <EnvVars />,
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: CreditCard,
    title: 'Billing',
    render: () => <Billing />,
  },
  {
    id: 'triggers',
    label: 'Triggers',
    icon: Webhook,
    title: 'Triggers',
    description: 'Inbound webhook URLs that trigger your agents.',
    render: () => <Triggers />,
  },
  {
    id: 'sessions',
    label: 'Sessions',
    icon: Share2,
    title: 'Sessions & delegations',
    description: 'Every chat and hook session — its delegates, inputs, and token cost.',
    render: () => <Sessions />,
  },
  {
    id: 'hooks',
    label: 'Hooks',
    icon: Zap,
    title: 'Automated hooks',
    description: 'Scheduled, event, and webhook hooks across your projects — enable or disable each.',
    render: () => <Hooks />,
  },
  {
    id: 'backup',
    label: 'Backup',
    icon: GitBranch,
    title: 'Workspace Backup',
    render: () => <WorkspaceBackup />,
  },
]

export interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which tab to open on mount. Defaults to `account`. */
  initialTab?: string
}

/**
 * Shared account + workspace settings dialog, opened from the chat and studio
 * sidebar footers. Side-tabbed: Account, Models, Environment, Billing,
 * Triggers and Workspace Backup. Depends only on `@lmthing/auth`, so it works
 * identically on every surface.
 *
 * Per-project integrations (installed from the store) have their own settings
 * surface — see `ProjectSettingsView` (`/studio/$projectId/settings`) — not a
 * tab here, since env vars are pod-global but integrations are per-project.
 */
export function SettingsDialog({ open, onOpenChange, initialTab = 'account' }: SettingsDialogProps) {
  const [active, setActive] = React.useState(initialTab)

  // Reset to the requested tab each time the dialog is (re)opened.
  React.useEffect(() => {
    if (open) setActive(initialTab)
  }, [open, initialTab])

  const current = TABS.find((t) => t.id === active) ?? TABS[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...PANEL_SIZE}>
        <DialogHeader>
          <DialogTitle asChild>
            <Heading level={2}>Settings</Heading>
          </DialogTitle>
          <DialogDescription asChild>
            <Caption muted>Your account and workspace preferences.</Caption>
          </DialogDescription>
        </DialogHeader>

        <Prim.Box {...BODY}>
          <Prim.Box as="nav" {...TABS_RAIL} aria-label="Settings sections">
            {TABS.map((t) => {
              const Icon = t.icon
              return (
                <Prim.Pressable
                  key={t.id}
                  type="button"
                  onClick={() => setActive(t.id)}
                  {...TAB}
                  {...(t.id === active ? TAB_ACTIVE : {})}
                  aria-current={t.id === active ? 'page' : undefined}
                >
                  <Icon style={TAB_ICON_STYLE} aria-hidden="true" />
                  {t.label}
                </Prim.Pressable>
              )
            })}
          </Prim.Box>

          <Prim.Box {...PANEL}>
            <Prim.Box as="section" {...SECTION}>
              <Heading level={4}>{current.title}</Heading>
              {current.description && <Caption muted>{current.description}</Caption>}
              {current.render()}
            </Prim.Box>
          </Prim.Box>
        </Prim.Box>
      </DialogContent>
    </Dialog>
  )
}

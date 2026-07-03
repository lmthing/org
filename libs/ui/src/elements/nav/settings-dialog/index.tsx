import '@lmthing/css/elements/nav/settings-dialog/index.css'
import * as React from 'react'
import { User, Cpu, Terminal, CreditCard, GitBranch, type LucideIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../overlays/dialog'
import { Heading } from '../../typography/heading'
import { Caption } from '../../typography/caption'
import { cn } from '../../../lib/utils'
import { Account } from '../../settings/account'
import { Models } from '../../settings/models'
import { EnvVars } from '../../settings/env-vars'
import { Billing } from '../../settings/billing'
import { WorkspaceBackup } from '../../settings/backup'

interface TabDef {
  id: string
  label: string
  icon: LucideIcon
  title: string
  description?: string
  render: () => React.ReactNode
}

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
 * sidebar footers. Side-tabbed: Account, Models, Environment, Billing and
 * Workspace Backup. Depends only on `@lmthing/auth`, so it works identically on
 * every surface.
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
      <DialogContent className="settings-dialog">
        <DialogHeader>
          <DialogTitle asChild>
            <Heading level={2}>Settings</Heading>
          </DialogTitle>
          <DialogDescription asChild>
            <Caption muted>Your account and workspace preferences.</Caption>
          </DialogDescription>
        </DialogHeader>

        <div className="settings-dialog__body">
          <nav className="settings-dialog__tabs" aria-label="Settings sections">
            {TABS.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActive(t.id)}
                  className={cn(
                    'settings-dialog__tab',
                    t.id === active && 'settings-dialog__tab--active',
                  )}
                  aria-current={t.id === active ? 'page' : undefined}
                >
                  <Icon className="settings-dialog__tab-icon" aria-hidden="true" />
                  {t.label}
                </button>
              )
            })}
          </nav>

          <div className="settings-dialog__panel">
            <section className="settings-dialog__section">
              <Heading level={4}>{current.title}</Heading>
              {current.description && <Caption muted>{current.description}</Caption>}
              {current.render()}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

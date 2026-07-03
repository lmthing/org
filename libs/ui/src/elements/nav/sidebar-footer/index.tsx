import * as React from 'react'
import { Settings } from 'lucide-react'
import { useAuth } from '@lmthing/auth'
import { cn } from '../../../lib/utils'
import { AppLinks } from '../app-links'
import { SettingsDialog } from '../settings-dialog'
import type { LmthingApp } from '../../../lib/app-urls'

/** Initials for the avatar fallback, derived from a name or email. */
function initials(label: string): string {
  const cleaned = label.split('@')[0].replace(/[._-]+/g, ' ').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export interface SidebarFooterProps {
  /** Current surface — its own link is omitted from the cross-app row. */
  current: LmthingApp
  /** Optional surface-specific footer content (e.g. chat's project settings). */
  children?: React.ReactNode
  className?: string
}

/**
 * Shared sidebar footer used by both chat and studio: the cross-app link row,
 * any surface-specific extras, and an account row showing the logged-in user
 * with a Settings button that opens the shared {@link SettingsDialog}.
 */
export function SidebarFooter({ current, children, className }: SidebarFooterProps) {
  const { username, session, isAuthenticated } = useAuth()
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const displayName = username ?? session?.email ?? null

  return (
    <div className={cn('flex flex-col', className)}>
      <AppLinks current={current} className="app-links--bordered" />

      {children}

      <button
        onClick={() => setSettingsOpen(true)}
        className="flex items-center gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        title="Settings"
      >
        {isAuthenticated && displayName ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
            {initials(displayName)}
          </span>
        ) : (
          <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span className="flex-1 truncate text-sm">
          {isAuthenticated && displayName ? displayName : 'Settings'}
        </span>
        <Settings className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
      </button>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

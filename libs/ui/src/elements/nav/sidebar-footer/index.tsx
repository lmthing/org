import * as Prim from '../../primitives/index.js';
import * as React from 'react'
import { Settings } from 'lucide-react'
import { useAuth } from '@lmthing/auth'
import { cn } from '../../../lib/utils'
import { AppLinks } from '../app-links'
import { SettingsDialog } from '../settings-dialog'
import { initials } from '../../settings/account'
import type { LmthingApp } from '../../../lib/app-urls'

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
    <Prim.Box className={className} display="flex" flexDirection="column">
      <AppLinks current={current} bordered />

      {children}

      <Prim.Pressable
        onClick={() => setSettingsOpen(true)}
        transition="quick" animateOnly={["color", "background-color", "border-color"]} display="flex" alignItems="center" gap="$2" paddingHorizontal="$3" paddingVertical="$2" textAlign="left" color="$muted-foreground" hoverStyle={{ color: "$foreground", backgroundColor: "color-mix(in srgb, var(--muted) 60%, transparent)" }}
        title="Settings"
      >
        {isAuthenticated && displayName ? (
          <Prim.Text display="flex" height="$6" width="$6" flexShrink={0} alignItems="center" justifyContent="center" borderRadius="$radius-full" backgroundColor="$muted" fontSize="$xs" fontWeight="$medium" color="$foreground">
            {initials(displayName)}
          </Prim.Text>
        ) : (
          <Settings size={16} style={{ flexShrink: 0 }} aria-hidden="true" />
        )}
        <Prim.Text flexGrow={1} flexShrink={1} flexBasis="0%" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" fontSize="$sm">
          {isAuthenticated && displayName ? displayName : 'Settings'}
        </Prim.Text>
        <Settings size={16} style={{ flexShrink: 0, opacity: 0.6 }} aria-hidden="true" />
      </Prim.Pressable>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Prim.Box>
  )
}

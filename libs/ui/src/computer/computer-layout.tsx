import * as Prim from '../elements/primitives/index.js';
import { CozyThingText } from '../elements/branding/cozy-text'
import { Sidebar, SidebarItem } from '../elements/nav/sidebar'
import { TopBar } from '../elements/nav/top-bar'
import { Badge } from '../elements/content/badge'
import { otherAppLinks } from '../lib/app-urls'
import { ConnectionBanner } from './connection-banner'
import type { RuntimeStatus, RuntimeTier } from './status-card'
import { SIDEBAR_ITEM } from '../elements/nav/sidebar/index.js'

export interface ComputerLayoutProps {
  status: RuntimeStatus
  tier: RuntimeTier
  currentPath: string
  onNavigate: (path: string) => void
  error?: string | null
  onRetry?: () => void
  onRestart?: () => void
  restarting?: boolean
  children: React.ReactNode
}

const navItems = [
  { path: '/computer', label: 'Dashboard' },
  { path: '/computer/terminal', label: 'Terminal' },
  { path: '/computer/spaces', label: 'Spaces' },
  { path: '/computer/settings', label: 'Settings' },
]

function ComputerLayout({ status, tier, currentPath, onNavigate, error, onRetry, onRestart, restarting, children }: ComputerLayoutProps) {
  const connectionState = status === 'error' ? 'error' as const
    : status === 'booting' ? 'booting' as const
    : 'connected' as const

  return (
    <Prim.Box display="flex" height="100vh" overflow="hidden">
      <Sidebar style={{ justifyContent: 'space-between' }}>
        <Prim.Box>
          {navItems.map((item) => (
            <SidebarItem
              key={item.path}
              active={currentPath === item.path}
              onClick={() => onNavigate(item.path)}
              cursor="pointer"
            >
              {item.label}
            </SidebarItem>
          ))}
        </Prim.Box>
        <Prim.Box>
          {otherAppLinks('computer').map((link) => (
            <Prim.Link
              key={link.app}
              href={link.url}
              {...SIDEBAR_ITEM}
              title={`Open lmthing.${link.app}`}
              display="block" textDecorationLine="none"
            >
              {link.emoji} {link.label}
            </Prim.Link>
          ))}
          {onRestart && (
            <SidebarItem
              onClick={restarting ? undefined : onRestart}
              cursor={restarting ? 'default' : 'pointer'} opacity={restarting ? 0.5 : 1}
              title="Restart CLI process (reloads .env)"
            >
              {restarting ? '↻ Restarting…' : '⏻ Restart'}
            </SidebarItem>
          )}
        </Prim.Box>
      </Sidebar>
      <Prim.Box
        flexGrow={1}
        flexShrink={1}
        flexBasis="0%"
        display="flex"
        flexDirection="column"
        minWidth={0}
      >
        <TopBar
          title={<CozyThingText text="lmthing.computer" />}
          actions={
            <>
              <Badge variant={status === 'running' ? 'success' : 'muted'}>{status}</Badge>
              <Badge variant={tier === 'flyio' ? 'primary' : 'muted'}>
                {tier === 'flyio' ? 'Computer' : 'Free'}
              </Badge>
            </>
          }
        />
        <ConnectionBanner
          state={connectionState}
          error={error}
          onRetry={onRetry}
        />
        <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflow="auto">
          {children}
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

export { ComputerLayout }

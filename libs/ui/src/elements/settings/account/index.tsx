import * as Prim from '../../primitives/index.js';
import { useAuth } from '@lmthing/auth'
import { Button } from '../../forms/button'
import { Caption } from '../../typography/caption'
import { Avatar, AvatarFallback } from '../../content/avatar'

/** Initials for the avatar fallback, derived from a name or email. */
export function initials(label: string): string {
  const cleaned = label.split('@')[0].replace(/[._-]+/g, ' ').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Account section content (no heading/card): the logged-in user's avatar, name
 * and email, with a log-out button. Used by the shared settings dialog and the
 * computer settings page.
 */
export function Account() {
  const { username, session, isAuthenticated, logout } = useAuth()
  const displayName = username ?? session?.email ?? null

  if (!isAuthenticated || !displayName) {
    return <Caption muted>Not logged in.</Caption>
  }

  return (
    <Prim.Box display="flex" alignItems="center" gap="0.75rem">
      <Avatar>
        <AvatarFallback colorKey={session?.userId ?? displayName}>
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
      <Prim.Box display="flex" flexDirection="column" minWidth={0}>
        <Caption>{displayName}</Caption>
        {session?.email && username && session.email !== username && (
          <Caption muted>{session.email}</Caption>
        )}
      </Prim.Box>
      <Prim.Box marginLeft="auto">
        <Button variant="ghost" size="sm" onClick={logout}>
          Log out
        </Button>
      </Prim.Box>
    </Prim.Box>
  )
}

import * as Prim from '../../../elements/primitives/index';
import { Search, UserPlus, Clock, Mail } from 'lucide-react'
import { useUIState, useToggle } from '@lmthing/state'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Sidebar } from '@lmthing/ui/elements/nav/sidebar'
import { PanelHeader } from '@lmthing/ui/elements/content/panel'
import { ListItem } from '@lmthing/ui/elements/content/list-item'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Avatar, AvatarImage, AvatarFallback } from '@lmthing/ui/elements/content/avatar'
import { INPUT_BASE, INPUT_SM } from '../../../elements/forms/input/index'
import { DIALOG_BACKDROP, DIALOG_CONTENT, DIALOG_HEADER } from '../../../elements/overlays/dialog/index'
import { SPACE_LIST_EMAIL, SPACE_LIST_EMAIL_ICON, SPACE_LIST_EMAIL_ROW, SPACE_LIST_EMPTY, SPACE_LIST_EMPTY_ICON, SPACE_LIST_HEADER, SPACE_LIST_INVITE_ACTIONS, SPACE_LIST_INVITE_ACTION_BTN, SPACE_LIST_INVITE_FORM_BODY, SPACE_LIST_INVITE_ICON, SPACE_LIST_INVITE_ROLE_ITEM, SPACE_LIST_INVITE_ROLE_RADIO, SPACE_LIST_LAST_ACTIVE, SPACE_LIST_LAST_ACTIVE_ICON, SPACE_LIST_SEARCH_ICON, SPACE_LIST_SEARCH_INPUT, SPACE_LIST_STATUS_BADGE, SPACE_LIST_USER_LIST, SPACE_LIST_USER_NAME_ROW } from '../props'

export interface SpaceUser {
  id: string
  name: string
  email: string
  role: SpaceUserRole
  status: 'active' | 'invited' | 'pending'
  avatarUrl?: string
  lastActive: string | null
  joinedAt: string | null
}

export type SpaceUserRole = 'admin' | 'editor' | 'viewer'

export interface RoleDefinition {
  value: string
  label: string
  description: string
}

interface SpaceListProps {
  users: SpaceUser[]
  selectedUserId?: string | null
  searchQuery?: string
  onSelectUser?: (userId: string) => void
  onSearchChange?: (query: string) => void
  onInviteUser?: (email: string, role: SpaceUserRole) => void
}

interface InviteDialogProps {
  isOpen: boolean
  onClose: () => void
  onInvite: (email: string, role: SpaceUserRole) => void
}

// .space-list__status-dot--<status> fill modifier → token lookup (its retired `styled()` proof `status` variant).
const STATUS_DOT_BG: Record<SpaceUser['status'], string> = {
  active: '$brand-2',
  invited: '$brand-2',
  pending: '$neutral',
}

function getRoleBadgeColor(role: SpaceUserRole) {
  switch (role) {
    case 'admin': return 'space-list__role-badge--admin'
    case 'editor': return 'space-list__role-badge--editor'
    case 'viewer': return 'space-list__role-badge--viewer'
    default: return 'space-list__role-badge--viewer'
  }
}

function InviteDialog({ isOpen, onClose, onInvite }: InviteDialogProps) {
  const [email, setEmail] = useUIState('space-list.invite-email', '')
  const [role, setRole] = useUIState<SpaceUserRole>('space-list.invite-role', 'viewer')

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email.trim()) {
      onInvite(email.trim(), role)
      setEmail('')
      setRole('viewer')
      onClose()
    }
  }

  return (
    <Prim.Box {...DIALOG_BACKDROP}>
      <Prim.Box {...DIALOG_CONTENT} maxWidth={448}>
        <Prim.Box {...DIALOG_HEADER}>
          <Heading level={3}>Invite User</Heading>
          <Caption muted>Add a new member to your space</Caption>
        </Prim.Box>
        <Prim.Form onSubmit={handleSubmit}>
          <Stack gap="md" {...SPACE_LIST_INVITE_FORM_BODY}>
            <Prim.Box>
              <Label compact>Email Address</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@organization.org"
                autoFocus
              />
            </Prim.Box>
            <Prim.Box>
              <Label compact>Role</Label>
              <Stack gap="sm">
                {[
                  { value: 'viewer' as const, label: 'Viewer', desc: 'Read-only access' },
                  { value: 'editor' as const, label: 'Editor', desc: 'Can create and modify' },
                  { value: 'admin' as const, label: 'Admin', desc: 'Full access including users' }
                ].map((r) => (
                  <Prim.Text as="label" key={r.value}>
                    <ListItem selected={role === r.value} {...SPACE_LIST_INVITE_ROLE_ITEM}>
                      <Prim.TextField
                        type="radio"
                        name="role"
                        value={r.value}
                        checked={role === r.value}
                        onChange={(e) => setRole(e.target.value as SpaceUserRole)}
                        {...SPACE_LIST_INVITE_ROLE_RADIO}
                      />
                      <Prim.Box>
                        <Label>{r.label}</Label>
                        <Caption muted>{r.desc}</Caption>
                      </Prim.Box>
                    </ListItem>
                  </Prim.Text>
                ))}
              </Stack>
            </Prim.Box>
            <Stack row gap="sm" {...SPACE_LIST_INVITE_ACTIONS}>
              <Button type="button" onClick={onClose} variant="ghost" {...SPACE_LIST_INVITE_ACTION_BTN}>Cancel</Button>
              <Button type="submit" variant="primary" {...SPACE_LIST_INVITE_ACTION_BTN}>Send Invite</Button>
            </Stack>
          </Stack>
        </Prim.Form>
      </Prim.Box>
    </Prim.Box>
  )
}

export function SpaceList({
  users,
  selectedUserId,
  searchQuery = '',
  onSelectUser,
  onSearchChange,
  onInviteUser
}: SpaceListProps) {
  const [showInvite, , setShowInvite] = useToggle('space-list.show-invite', false)

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <>
      <Sidebar>
        <PanelHeader>
          <Stack row {...SPACE_LIST_HEADER}>
            <Prim.Box>
              <Heading level={3}>Members</Heading>
              <Caption muted>{users.length} {users.length === 1 ? 'member' : 'members'}</Caption>
            </Prim.Box>
            <Button onClick={() => setShowInvite(true)} variant="primary" size="sm" aria-label="Add user">
              <UserPlus {...SPACE_LIST_INVITE_ICON} />
            </Button>
          </Stack>
          <Prim.Box position="relative" marginTop="$4">
            <Search {...SPACE_LIST_SEARCH_ICON} />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Search by name or email..."
              {...INPUT_BASE} {...INPUT_SM} {...SPACE_LIST_SEARCH_INPUT}
            />
          </Prim.Box>
        </PanelHeader>

        <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" overflowY="auto">
          {filteredUsers.length === 0 ? (
            <Stack {...SPACE_LIST_EMPTY}>
              <Search {...SPACE_LIST_EMPTY_ICON} />
              <Caption muted>No users found</Caption>
            </Stack>
          ) : (
            <Stack gap="sm" {...SPACE_LIST_USER_LIST}>
              {filteredUsers.map((user) => (
                <Prim.Pressable
                  key={user.id}
                  onClick={() => onSelectUser?.(user.id)}
                  cursor="pointer"
                  display="block"
                  width="100%"
                >
                  <ListItem selected={selectedUserId === user.id}>
                    <Prim.Box position="relative" flexShrink={0}>
                      <Avatar>
                        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                        <AvatarFallback className="space-list__avatar-fallback" colorKey={user.id}>
                          {user.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <Prim.Box
                        position="absolute"
                        bottom={-2}
                        right={-2}
                        width="$3.5"
                        height="$3.5"
                        borderRadius="$radius-full"
                        borderWidth={2}
                        borderStyle="solid"
                        borderColor="white"
                        backgroundColor={STATUS_DOT_BG[user.status]}
                      />
                    </Prim.Box>
                    <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0} textAlign="left">
                      <Stack row gap="sm" {...SPACE_LIST_USER_NAME_ROW}>
                        <Prim.Text fontWeight="$medium" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{user.name}</Prim.Text>
                        <Badge className={`${getRoleBadgeColor(user.role)} space-list__role-badge`}>
                          {user.role.charAt(0).toUpperCase()}
                        </Badge>
                      </Stack>
                      <Stack row gap="sm" {...SPACE_LIST_EMAIL_ROW}>
                        <Mail {...SPACE_LIST_EMAIL_ICON} />
                        <Caption muted {...SPACE_LIST_EMAIL}>{user.email}</Caption>
                      </Stack>
                    </Prim.Box>
                    <Prim.Box display="flex" flexDirection="column" alignItems="flex-end" gap="$1">
                      <Badge variant={user.status === 'active' ? 'success' : user.status === 'invited' ? 'primary' : 'muted'} {...SPACE_LIST_STATUS_BADGE}>
                        {user.status}
                      </Badge>
                      {user.lastActive && (
                        <Caption muted {...SPACE_LIST_LAST_ACTIVE}>
                          <Clock {...SPACE_LIST_LAST_ACTIVE_ICON} />
                          {formatDate(user.lastActive)}
                        </Caption>
                      )}
                    </Prim.Box>
                  </ListItem>
                </Prim.Pressable>
              ))}
            </Stack>
          )}
        </Prim.Box>
      </Sidebar>

      {onInviteUser && (
        <InviteDialog isOpen={showInvite} onClose={() => setShowInvite(false)} onInvite={onInviteUser} />
      )}
    </>
  )
}

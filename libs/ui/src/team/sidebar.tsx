/**
 * The channel sidebar: categories, the channels filed under them, and the direct
 * messages below.
 *
 * Categories are collapsible and collapse state is LOCAL (not stored on the
 * pod) — which sections you have folded away is about your screen right now, not
 * something the team agreed on, and syncing it would mean one member's tidying
 * up rearranges everyone else's sidebar.
 */

import * as Prim from '../elements/primitives/index'
import { ListItem } from '../elements/content/list-item'
import { Avatar, AvatarFallback } from '../elements/content/avatar'
import { Button } from '../elements/forms/button'
import { Input } from '../elements/forms/input'
import { Caption } from '../elements/typography/caption'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from '../elements/overlays/dropdown'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../elements/overlays/dialog'
import { Badge } from '../elements/content/badge'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FolderKanbanIcon,
  HashIcon,
  MoreVerticalIcon,
  PlusIcon,
  UsersIcon,
} from './icons'
import { useMemo, useState } from 'react'
import { SurfaceSwitcher } from '../elements/nav/surface-switcher'
import type { Category, Channel, ChannelUnread, DirectoryProject, MemberProfile } from './types'
import { dmPartner, initials, memberLabel } from './format'

export interface SidebarProps {
  /** Compact: the sidebar is a slide-over, not a column, and closes on select. */
  compact?: boolean
  onDismiss?: () => void
  /** The team this sidebar belongs to. On a phone this is the ONLY place it is named. */
  team?: { id: string; name: string } | undefined
  /** Every team the member is on, for the switcher. One entry hides the affordance. */
  teams?: readonly { id: string; name: string }[] | undefined
  onSwitchTeam?: ((teamId: string) => void) | undefined
  onSwitchSurface?: ((surface: 'home' | 'chat' | 'teams') => void) | undefined
  channels: Channel[]
  categories: Category[]
  members: MemberProfile[]
  meId: string
  activeId: string | null
  isEditor: boolean
  unread: Map<string, ChannelUnread>
  onSelect: (channelId: string) => void
  onCreateChannel: (name: string, categoryId?: string) => void
  onCreateCategory: (name: string) => void
  onDeleteCategory: (categoryId: string) => void
  onMoveChannel: (channelId: string, categoryId: string | null) => void
  onOpenDm: (userId: string) => void
  projects?: DirectoryProject[]
  onOpenApp?: (projectId: string) => void
}

/**
 * The unread treatment: a channel with anything new is BOLD, a channel that
 * named you carries a count.
 *
 * Two levels rather than one, because they answer different questions. Bold says
 * "there is something here" and can be ignored; a number says "somebody is
 * waiting on you" and cannot. Collapsing them into one badge makes a busy
 * channel shout as loudly as a direct question, which is how people end up
 * muting everything.
 */
function MentionBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <Prim.Text
      backgroundColor="$primary"
      color="$primary-foreground"
      fontSize="$xs"
      fontWeight="$semibold"
      borderRadius="$radius-full"
      minWidth="$5"
      paddingHorizontal="$1.5"
      textAlign="center"
      flexShrink={0}
    >
      {count > 99 ? '99+' : count}
    </Prim.Text>
  )
}

export function ChannelSidebar(props: SidebarProps) {
  const { channels, categories, members, meId, activeId, isEditor, unread, compact } = props
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [activeTab, setActiveTab] = useState<'channels' | 'projects' | 'members'>('channels')

  const named = useMemo(() => channels.filter((c) => c.kind !== 'dm'), [channels])
  const dms = useMemo(() => channels.filter((c) => c.kind === 'dm'), [channels])

  /**
   * Sections in the order they are read: each category in its own order, then
   * everything that has not been filed. Uncategorized goes LAST rather than
   * first — a team that has organised some of its channels has said those
   * matter, and burying them under the unsorted pile undoes the organising.
   */
  const sections = useMemo(() => {
    const byCategory = new Map<string, Channel[]>()
    const loose: Channel[] = []
    for (const channel of named) {
      const key = channel.categoryId
      if (key && categories.some((c) => c.id === key)) {
        const list = byCategory.get(key) ?? []
        list.push(channel)
        byCategory.set(key, list)
      } else {
        loose.push(channel)
      }
    }
    const out = categories.map((category) => ({
      key: category.id,
      title: category.name,
      category,
      channels: byCategory.get(category.id) ?? [],
    }))
    if (loose.length || !categories.length) {
      out.push({
        key: '',
        title: categories.length ? 'Uncategorized' : 'Channels',
        category: null as unknown as Category,
        channels: loose,
      })
    }
    return out
  }, [named, categories])

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const submitNew = (categoryId: string) => {
    const name = draft.trim()
    if (name) props.onCreateChannel(name, categoryId || undefined)
    setDraft('')
    setAdding(null)
  }

  return (
    <Prim.Col
      width={compact ? 280 : 230}
      maxWidth="85%"
      flexShrink={0}
      borderRightWidth={1}
      borderColor="$border"
      paddingVertical="$2"
      overflow="auto"
      height="100%"
      {...(compact
        ? ({
            backgroundColor: '$background',
            boxShadow: '0 0 40px color-mix(in srgb, var(--foreground) 18%, transparent)',
          } as const)
        : {})}
    >
      <SidebarHeader
        team={props.team}
        teams={props.teams}
        isEditor={isEditor}
        memberCount={members.length}
        compact={compact}
        {...(props.onSwitchTeam ? { onSwitchTeam: props.onSwitchTeam } : {})}
        {...(props.onDismiss ? { onDismiss: props.onDismiss } : {})}
      />

      <Prim.Row paddingHorizontal="$2" marginBottom="$2.5" gap="$1">
        <Prim.Pressable
          flex={1}
          paddingVertical="$1.5"
          alignItems="center"
          justifyContent="center"
          borderRadius="$radius-md"
          backgroundColor={activeTab === 'channels' ? '$muted' : 'transparent'}
          hoverStyle={{ backgroundColor: activeTab === 'channels' ? '$muted' : 'color-mix(in srgb, var(--muted) 40%, transparent)' }}
          onClick={() => setActiveTab('channels')}
          aria-label="Channels tab"
        >
          <Prim.Row alignItems="center" gap="$1">
            <HashIcon size={12} color={activeTab === 'channels' ? 'var(--foreground)' : 'var(--muted-foreground)'} />
            <Prim.Text
              fontSize="$xs"
              fontWeight={activeTab === 'channels' ? '$semibold' : '$medium'}
              color={activeTab === 'channels' ? '$foreground' : '$muted-foreground'}
            >
              Chat
            </Prim.Text>
          </Prim.Row>
        </Prim.Pressable>

        <Prim.Pressable
          flex={1}
          paddingVertical="$1.5"
          alignItems="center"
          justifyContent="center"
          borderRadius="$radius-md"
          backgroundColor={activeTab === 'projects' ? '$muted' : 'transparent'}
          hoverStyle={{ backgroundColor: activeTab === 'projects' ? '$muted' : 'color-mix(in srgb, var(--muted) 40%, transparent)' }}
          onClick={() => setActiveTab('projects')}
          aria-label="Projects tab"
        >
          <Prim.Row alignItems="center" gap="$1">
            <FolderKanbanIcon size={12} color={activeTab === 'projects' ? 'var(--foreground)' : 'var(--muted-foreground)'} />
            <Prim.Text
              fontSize="$xs"
              fontWeight={activeTab === 'projects' ? '$semibold' : '$medium'}
              color={activeTab === 'projects' ? '$foreground' : '$muted-foreground'}
            >
              Projects
            </Prim.Text>
          </Prim.Row>
        </Prim.Pressable>

        <Prim.Pressable
          flex={1}
          paddingVertical="$1.5"
          alignItems="center"
          justifyContent="center"
          borderRadius="$radius-md"
          backgroundColor={activeTab === 'members' ? '$muted' : 'transparent'}
          hoverStyle={{ backgroundColor: activeTab === 'members' ? '$muted' : 'color-mix(in srgb, var(--muted) 40%, transparent)' }}
          onClick={() => setActiveTab('members')}
          aria-label="Members tab"
        >
          <Prim.Row alignItems="center" gap="$1">
            <UsersIcon size={12} color={activeTab === 'members' ? 'var(--foreground)' : 'var(--muted-foreground)'} />
            <Prim.Text
              fontSize="$xs"
              fontWeight={activeTab === 'members' ? '$semibold' : '$medium'}
              color={activeTab === 'members' ? '$foreground' : '$muted-foreground'}
            >
              Roster
            </Prim.Text>
          </Prim.Row>
        </Prim.Pressable>
      </Prim.Row>

      {activeTab === 'projects' ? (
        <SidebarProjects
          projects={props.projects}
          onOpenApp={props.onOpenApp}
          onDismiss={props.onDismiss}
        />
      ) : activeTab === 'members' ? (
        <SidebarMembers
          members={members}
          meId={meId}
          onOpenDm={props.onOpenDm}
          onDismiss={props.onDismiss}
        />
      ) : (
        <>
          {isEditor ? (
            <Prim.Box paddingHorizontal="$2" marginBottom="$2">
              <Button
                size="sm"
                variant="outline"
                width="100%"
                justifyContent="flex-start"
                onClick={() => {
                  setAdding(sections[sections.length - 1]?.key ?? '')
                  setDraft('')
                }}
              >
                <PlusIcon size={12} />
                New channel
              </Button>
            </Prim.Box>
          ) : null}

          {sections.map((section) => (
            <Prim.Col key={section.key} marginBottom="$2">
              <Prim.Row alignItems="center" gap="$0.5" paddingHorizontal="$2" paddingRight="$1">
                <Prim.Pressable
                  onClick={() => toggle(section.key)}
                  flex={1}
                  minWidth={0}
                  display="flex"
                  alignItems="center"
                  gap="$1"
                  paddingVertical="$1"
                >
                  {collapsed.has(section.key) ? (
                    <ChevronRightIcon size={12} />
                  ) : (
                    <ChevronDownIcon size={12} />
                  )}
                  <Prim.Text
                    fontSize="$xs"
                    fontWeight="$semibold"
                    color="$muted-foreground"
                    textTransform="uppercase"
                    letterSpacing="0.04em"
                  >
                    {section.title}
                  </Prim.Text>
                </Prim.Pressable>
                {isEditor ? (
                  <SectionMenu
                    categoryId={section.category?.id ?? null}
                    categoryName={section.title}
                    onAddChannel={() => {
                      setAdding(section.key)
                      setDraft('')
                    }}
                    onDelete={section.category ? () => props.onDeleteCategory(section.category.id) : null}
                  />
                ) : null}
              </Prim.Row>

              {collapsed.has(section.key) ? null : (
                <Prim.Col paddingHorizontal="$2" gap="$0.5">
                  {section.channels.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      active={channel.id === activeId}
                      categories={categories}
                      isEditor={isEditor}
                      unread={unread.get(channel.id)}
                      onSelect={() => {
                        props.onSelect(channel.id)
                        props.onDismiss?.()
                      }}
                      onMove={(categoryId) => props.onMoveChannel(channel.id, categoryId)}
                    />
                  ))}
                  {section.channels.length === 0 && adding !== section.key ? (
                    <Prim.Box paddingHorizontal="$2" paddingVertical="$1">
                      <Caption>No channels here.</Caption>
                    </Prim.Box>
                  ) : null}
                  {adding === section.key ? (
                    <Input
                      size="sm"
                      autoFocus
                      value={draft}
                      placeholder="Channel name"
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => submitNew(section.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitNew(section.key)
                        if (e.key === 'Escape') {
                          setDraft('')
                          setAdding(null)
                        }
                      }}
                    />
                  ) : null}
                </Prim.Col>
              )}
            </Prim.Col>
          ))}

          {isEditor ? <NewCategory onCreate={props.onCreateCategory} /> : null}

          <DirectMessages
            dms={dms}
            members={members}
            meId={meId}
            activeId={activeId}
            unread={unread}
            onSelect={(channelId) => {
              props.onSelect(channelId)
              props.onDismiss?.()
            }}
            onOpenDm={(userId) => {
              props.onOpenDm(userId)
              props.onDismiss?.()
            }}
          />
        </>
      )}

      {props.onSwitchSurface ? (
        <SurfaceSwitcher
          current="teams"
          onSwitch={(surface) => {
            props.onSwitchSurface?.(surface)
            props.onDismiss?.()
          }}
          bordered
        />
      ) : null}
    </Prim.Col>
  )
}

function SidebarProjects({
  projects = [],
  onOpenApp,
  onDismiss,
}: {
  projects?: DirectoryProject[]
  onOpenApp?: (projectId: string) => void
  onDismiss?: () => void
}) {
  return (
    <Prim.Col paddingHorizontal="$2" gap="$1" flex={1}>
      <Prim.Box paddingHorizontal="$2" paddingVertical="$1" marginBottom="$1">
        <Prim.Text
          fontSize="$xs"
          fontWeight="$semibold"
          color="$muted-foreground"
          textTransform="uppercase"
          letterSpacing="0.04em"
        >
          Projects ({projects.length})
        </Prim.Text>
      </Prim.Box>
      {projects.length === 0 ? (
        <Prim.Box paddingHorizontal="$2" paddingVertical="$2">
          <Caption>No projects in this team yet.</Caption>
        </Prim.Box>
      ) : (
        projects.map((project) => (
          <ListItem
            key={project.id}
            onClick={() => {
              if (project.hasApp && onOpenApp) {
                onOpenApp(project.id)
              }
              onDismiss?.()
            }}
          >
            <FolderKanbanIcon size={14} />
            <Prim.Text
              fontSize="$sm"
              marginLeft="$1.5"
              flex={1}
              minWidth={0}
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {project.name}
            </Prim.Text>
            {project.hasApp ? <Badge variant="primary">App</Badge> : null}
          </ListItem>
        ))
      )}
    </Prim.Col>
  )
}

function SidebarMembers({
  members = [],
  meId,
  onOpenDm,
  onDismiss,
}: {
  members: MemberProfile[]
  meId: string
  onOpenDm: (userId: string) => void
  onDismiss?: () => void
}) {
  return (
    <Prim.Col paddingHorizontal="$2" gap="$1" flex={1}>
      <Prim.Box paddingHorizontal="$2" paddingVertical="$1" marginBottom="$1">
        <Prim.Text
          fontSize="$xs"
          fontWeight="$semibold"
          color="$muted-foreground"
          textTransform="uppercase"
          letterSpacing="0.04em"
        >
          Members ({members.length})
        </Prim.Text>
      </Prim.Box>
      {members.length === 0 ? (
        <Prim.Box paddingHorizontal="$2" paddingVertical="$2">
          <Caption>No members found.</Caption>
        </Prim.Box>
      ) : (
        members.map((member) => {
          const label = memberLabel(member, member.userId)
          const isMe = member.userId === meId
          return (
            <ListItem
              key={member.userId}
              onClick={() => {
                if (!isMe) {
                  onOpenDm(member.userId)
                  onDismiss?.()
                }
              }}
            >
              <Avatar size="sm">
                <AvatarFallback colorKey={member.userId}>{initials(label)}</AvatarFallback>
              </Avatar>
              <Prim.Col flex={1} minWidth={0} marginLeft="$1.5">
                <Prim.Text fontSize="$sm" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  {label} {isMe ? '(you)' : ''}
                </Prim.Text>
                {member.email ? (
                  <Caption overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                    {member.email}
                  </Caption>
                ) : null}
              </Prim.Col>
            </ListItem>
          )
        })
      )}
    </Prim.Col>
  )
}

/**
 * Which team this is — and, when there is more than one, the way to another.
 *
 * It lives in the sidebar because that is the one piece of chrome BOTH targets have. The native app
 * renders `TeamChannelsView` and nothing else: it took the first team the gateway listed, never said
 * which, and gave no way to reach a second. A member on two teams could only see one of them, and
 * could not tell which one they were reading.
 */
function SidebarHeader({
  team,
  teams,
  isEditor,
  memberCount,
  compact,
  onSwitchTeam,
  onDismiss,
}: {
  team?: { id: string; name: string } | undefined
  teams?: readonly { id: string; name: string }[] | undefined
  isEditor: boolean
  memberCount: number
  compact?: boolean
  onSwitchTeam?: (teamId: string) => void
  onDismiss?: () => void
}) {
  const others = (teams ?? []).filter((t) => t.id !== team?.id)
  const canSwitch = Boolean(onSwitchTeam) && others.length > 0
  if (!team) return null

  const identity = (
    <Prim.Row alignItems="center" gap="$2" flex={1} minWidth={0}>
      <Avatar size="sm">
        <AvatarFallback colorKey={team.id}>{initials(team.name)}</AvatarFallback>
      </Avatar>
      <Prim.Col flex={1} minWidth={0}>
        <Prim.Text
          fontSize="$sm"
          fontWeight="$semibold"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
        >
          {team.name}
        </Prim.Text>
        <Caption>
          {isEditor ? 'Editor' : 'Viewer'} · {memberCount === 1 ? '1 member' : `${memberCount} members`}
        </Caption>
      </Prim.Col>
      {canSwitch ? <ChevronDownIcon size={12} /> : null}
    </Prim.Row>
  )

  return (
    <Prim.Row
      alignItems="center"
      gap="$1"
      paddingHorizontal="$2"
      paddingBottom="$2"
      marginBottom="$2"
      borderBottomWidth={1}
      borderColor="$border"
    >
      {canSwitch ? (
        <Dropdown>
          <DropdownTrigger asChild>
            <Prim.Pressable
              flex={1}
              minWidth={0}
              display="flex"
              borderRadius="$radius-md"
              paddingVertical="$1"
              paddingHorizontal="$1"
              hoverStyle={{ backgroundColor: '$muted' }}
              pressStyle={{ opacity: 0.7 }}
              aria-label="Switch team"
            >
              {identity}
            </Prim.Pressable>
          </DropdownTrigger>
          <DropdownContent>
            {others.map((other) => (
              <DropdownItem key={other.id} onClick={() => onSwitchTeam?.(other.id)}>
                {other.name}
              </DropdownItem>
            ))}
          </DropdownContent>
        </Dropdown>
      ) : (
        <Prim.Box flex={1} minWidth={0} paddingVertical="$1" paddingHorizontal="$1">
          {identity}
        </Prim.Box>
      )}
      {/* A drawer that can only be dismissed by hitting the strip of scrim beside it is a drawer
          people learn to be afraid of. */}
      {compact && onDismiss ? (
        <Button size="icon" variant="ghost" onClick={onDismiss} aria-label="Close channels">
          <CloseIcon size={14} />
        </Button>
      ) : null}
    </Prim.Row>
  )
}

/**
 * One click of a 24px dropdown row used to delete a category outright — the smallest, easiest to
 * mis-tap control on the surface, wired straight to a destructive call. Routed through the same
 * `Dialog` confirmation `settings.tsx` already uses for "Delete team", rather than inventing a
 * second pattern for the same kind of action.
 */
function SectionMenu({
  categoryId,
  categoryName,
  onAddChannel,
  onDelete,
}: {
  categoryId: string | null
  categoryName: string
  onAddChannel: () => void
  onDelete: (() => void) | null
}) {
  void categoryId
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="Section actions">
            <MoreVerticalIcon size={14} />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem onClick={onAddChannel}>Add channel</DropdownItem>
          {onDelete ? (
            <DropdownItem onClick={() => setConfirming(true)}>Delete category</DropdownItem>
          ) : null}
        </DropdownContent>
      </Dropdown>
      {onDelete ? (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle asChild>
                <Prim.Text fontSize="$base" fontWeight="$semibold">
                  Delete "{categoryName}"?
                </Prim.Text>
              </DialogTitle>
              <DialogDescription asChild>
                <Caption>
                  Its channels are not deleted — they move back to the uncategorized list.
                </Caption>
              </DialogDescription>
            </DialogHeader>
            <Prim.Row gap="$2" justifyContent="flex-end" marginTop="$3">
              <DialogClose asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirming(false)
                  onDelete()
                }}
              >
                Delete category
              </Button>
            </Prim.Row>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

function ChannelRow({
  channel,
  active,
  categories,
  isEditor,
  unread,
  onSelect,
  onMove,
}: {
  channel: Channel
  active: boolean
  categories: Category[]
  isEditor: boolean
  unread: ChannelUnread | undefined
  onSelect: () => void
  onMove: (categoryId: string | null) => void
}) {
  const bold = !!unread?.hasUnread && !active
  return (
    <Prim.Row alignItems="center" gap="$0.5">
      <Prim.Box flex={1} minWidth={0}>
        <ListItem selected={active} onClick={onSelect}>
          <HashIcon size={14} />
          <Prim.Text
            fontSize="$sm"
            marginLeft="$1.5"
            flex={1}
            minWidth={0}
            fontWeight={bold ? '$semibold' : '$normal'}
            color={bold ? '$foreground' : undefined}
          >
            {channel.name}
          </Prim.Text>
          <MentionBadge count={unread?.mentions ?? 0} />
        </ListItem>
      </Prim.Box>
      {isEditor && categories.length ? (
        <Dropdown>
          <DropdownTrigger asChild>
            <Button size="icon" variant="ghost" aria-label={`Move #${channel.name}`}>
              <MoreVerticalIcon size={12} />
            </Button>
          </DropdownTrigger>
          <DropdownContent>
            {categories.map((category) => (
              <DropdownItem key={category.id} onClick={() => onMove(category.id)}>
                Move to {category.name}
              </DropdownItem>
            ))}
            {channel.categoryId ? (
              <DropdownItem onClick={() => onMove(null)}>Remove from category</DropdownItem>
            ) : null}
          </DropdownContent>
        </Dropdown>
      ) : null}
    </Prim.Row>
  )
}

function NewCategory({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const submit = () => {
    const name = draft.trim()
    if (name) onCreate(name)
    setDraft('')
    setOpen(false)
  }
  if (!open) {
    return (
      <Prim.Box paddingHorizontal="$2" marginBottom="$2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <PlusIcon size={12} />
          New category
        </Button>
      </Prim.Box>
    )
  }
  return (
    <Prim.Box paddingHorizontal="$2" marginBottom="$2">
      <Input
        size="sm"
        autoFocus
        value={draft}
        placeholder="Category name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') {
            setDraft('')
            setOpen(false)
          }
        }}
      />
    </Prim.Box>
  )
}

/**
 * The direct-message list.
 *
 * Every teammate is listed, not only the ones already talked to — the list is
 * the way to START a conversation, and hiding people behind a "new message"
 * dialog would make the common case (message a colleague) the longer path. An
 * existing conversation is simply the row that already has a channel behind it.
 */
function DirectMessages({
  dms,
  members,
  meId,
  activeId,
  unread,
  onSelect,
  onOpenDm,
}: {
  dms: Channel[]
  members: MemberProfile[]
  meId: string
  activeId: string | null
  unread: Map<string, ChannelUnread>
  onSelect: (channelId: string) => void
  onOpenDm: (userId: string) => void
}) {
  const channelByPartner = useMemo(() => {
    const map = new Map<string, Channel>()
    for (const dm of dms) {
      const partner = dmPartner(dm, meId)
      if (partner) map.set(partner, dm)
    }
    return map
  }, [dms, meId])

  /**
   * Named-channel rows are already ordered by whoever set up the sidebar's categories, and carry
   * bold/mention treatment on top of that ({@link MentionBadge}) — this list had neither: whatever
   * order `directory()` happened to return members in, which is not a fact about the team, just an
   * accident of how the roster file was walked.
   *
   * Ranked instead, most in need of attention first — mentions, then anything unread, then an
   * existing (read) conversation, then someone never messaged — with an alphabetical tiebreak
   * inside each tier so the order does not jitter between renders for two people in the same tier.
   *
   * Deliberately NOT "most recently active": the pod hands the client a boolean `hasUnread` and an
   * exact mention count, never a timestamp (`team-reads.ts#ChannelUnread`) — the same reason a
   * previous pass declined to draw an unread DIVIDER (`design/team-chat-ux-progress.md`). A
   * recency guess built from whichever messages happened to arrive over THIS socket since mount
   * would be wrong for anyone who was not watching the whole time, and unstable to boot — the kind
   * of bug that only shows up as "why did Bo jump to the top, nobody said anything".
   */
  const others = useMemo(() => {
    const rank = (userId: string): number => {
      const channel = channelByPartner.get(userId)
      if (!channel) return 3
      const badge = unread.get(channel.id)
      if (badge?.mentions) return 0
      if (badge?.hasUnread) return 1
      return 2
    }
    return members
      .filter((m) => m.userId !== meId)
      .sort((a, b) => {
        const ra = rank(a.userId)
        const rb = rank(b.userId)
        if (ra !== rb) return ra - rb
        if (ra === 0) {
          const ma = unread.get(channelByPartner.get(a.userId)!.id)?.mentions ?? 0
          const mb = unread.get(channelByPartner.get(b.userId)!.id)?.mentions ?? 0
          if (ma !== mb) return mb - ma
        }
        return memberLabel(a, a.userId).localeCompare(memberLabel(b, b.userId))
      })
  }, [members, meId, channelByPartner, unread])

  return (
    <Prim.Col marginTop="$1">
      <Prim.Box paddingHorizontal="$2" paddingVertical="$1">
        <Prim.Text
          fontSize="$xs"
          fontWeight="$semibold"
          color="$muted-foreground"
          textTransform="uppercase"
          letterSpacing="0.04em"
        >
          Direct messages
        </Prim.Text>
      </Prim.Box>
      <Prim.Col paddingHorizontal="$2" gap="$0.5">
        {others.length === 0 ? (
          <Prim.Box paddingHorizontal="$2" paddingVertical="$1">
            <Caption>Nobody else has opened this team yet.</Caption>
          </Prim.Box>
        ) : null}
        {others.map((member) => {
          const existing = channelByPartner.get(member.userId)
          const label = memberLabel(member, member.userId)
          const active = !!existing && existing.id === activeId
          const badge = existing ? unread.get(existing.id) : undefined
          const bold = !!badge?.hasUnread && !active
          return (
            <ListItem
              key={member.userId}
              selected={active}
              onClick={() => (existing ? onSelect(existing.id) : onOpenDm(member.userId))}
            >
              <Avatar size="sm">
                <AvatarFallback colorKey={member.userId}>{initials(label)}</AvatarFallback>
              </Avatar>
              <Prim.Text
                fontSize="$sm"
                marginLeft="$1.5"
                flex={1}
                minWidth={0}
                fontWeight={bold ? '$semibold' : '$normal'}
              >
                {label}
              </Prim.Text>
              <MentionBadge count={badge?.mentions ?? 0} />
            </ListItem>
          )
        })}
      </Prim.Col>
    </Prim.Col>
  )
}

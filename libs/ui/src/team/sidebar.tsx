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
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  HashIcon,
  MoreVerticalIcon,
  PlusIcon,
} from './icons'
import { useMemo, useState } from 'react'
import type { Category, Channel, ChannelUnread, MemberProfile } from './types'
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
    // The unfiled section is only worth a heading once there is something to
    // contrast it with; with no categories at all it is just "the channels" — the two branches
    // used to read the same either way, which said nothing distinct in the one case where a
    // reader actually needs telling apart from a named category ("Marketing", "Support", …).
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
      // As a drawer it must paint over the conversation, so it needs its own
      // background — as a column it inherits the page's and does not.
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

      {/* Creating a channel used to live only inside a section's `⋮`, next to "Delete category" —
          so the commonest thing an editor does here was two taps into a 24px menu, while the rarer
          "New category" had a row of its own. On a phone that menu is the hardest target on the
          screen. */}
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

  const others = members.filter((m) => m.userId !== meId)

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

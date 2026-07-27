/**
 * The channel sidebar: categories, the channels filed under them, and the direct
 * messages below.
 *
 * Categories are collapsible and collapse state is LOCAL (not stored on the
 * pod) — which sections you have folded away is about your screen right now, not
 * something the team agreed on, and syncing it would mean one member's tidying
 * up rearranges everyone else's sidebar.
 */

import * as Prim from '@lmthing/ui/elements/primitives'
import { ListItem } from '@lmthing/ui/elements/content/list-item'
import { Avatar, AvatarFallback } from '@lmthing/ui/elements/content/avatar'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from '@lmthing/ui/elements/overlays/dropdown'
import { ChevronDown, ChevronRight, Hash, MoreVertical, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dmPartner, memberLabel, type Category, type Channel, type MemberProfile } from '@/lib/team-pod'
import { initials } from '@/lib/team-format'

export interface SidebarProps {
  channels: Channel[]
  categories: Category[]
  members: MemberProfile[]
  meId: string
  activeId: string | null
  isEditor: boolean
  onSelect: (channelId: string) => void
  onCreateChannel: (name: string, categoryId?: string) => void
  onCreateCategory: (name: string) => void
  onDeleteCategory: (categoryId: string) => void
  onMoveChannel: (channelId: string, categoryId: string | null) => void
  onOpenDm: (userId: string) => void
}

export function ChannelSidebar(props: SidebarProps) {
  const { channels, categories, members, meId, activeId, isEditor } = props
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
    // contrast it with; with no categories at all it is just "the channels".
    if (loose.length || !categories.length) {
      out.push({
        key: '',
        title: categories.length ? 'Channels' : 'Channels',
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
      width={230}
      flexShrink={0}
      borderRightWidth={1}
      borderColor="$border"
      paddingVertical="$2"
      overflow="auto"
    >
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
                <ChevronRight size={12} aria-hidden={true} />
              ) : (
                <ChevronDown size={12} aria-hidden={true} />
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
                  onSelect={() => props.onSelect(channel.id)}
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
        onSelect={props.onSelect}
        onOpenDm={props.onOpenDm}
      />
    </Prim.Col>
  )
}

function SectionMenu({
  categoryId,
  onAddChannel,
  onDelete,
}: {
  categoryId: string | null
  onAddChannel: () => void
  onDelete: (() => void) | null
}) {
  void categoryId
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Section actions">
          <MoreVertical size={14} aria-hidden={true} />
        </Button>
      </DropdownTrigger>
      <DropdownContent>
        <DropdownItem onClick={onAddChannel}>Add channel</DropdownItem>
        {onDelete ? (
          <DropdownItem onClick={onDelete}>Delete category</DropdownItem>
        ) : null}
      </DropdownContent>
    </Dropdown>
  )
}

function ChannelRow({
  channel,
  active,
  categories,
  isEditor,
  onSelect,
  onMove,
}: {
  channel: Channel
  active: boolean
  categories: Category[]
  isEditor: boolean
  onSelect: () => void
  onMove: (categoryId: string | null) => void
}) {
  return (
    <Prim.Row alignItems="center" gap="$0.5">
      <Prim.Box flex={1} minWidth={0}>
        <ListItem selected={active} onClick={onSelect}>
          <Hash size={14} aria-hidden={true} />
          <Prim.Text fontSize="$sm" marginLeft="$1.5" flex={1} minWidth={0}>
            {channel.name}
          </Prim.Text>
          {channel.apps?.length ? (
            <Prim.Text fontSize="$xs" color="$muted-foreground">
              {channel.apps.length}
            </Prim.Text>
          ) : null}
        </ListItem>
      </Prim.Box>
      {isEditor && categories.length ? (
        <Dropdown>
          <DropdownTrigger asChild>
            <Button size="icon" variant="ghost" aria-label={`Move #${channel.name}`}>
              <MoreVertical size={12} aria-hidden={true} />
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
          <Plus size={12} aria-hidden={true} />
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
  onSelect,
  onOpenDm,
}: {
  dms: Channel[]
  members: MemberProfile[]
  meId: string
  activeId: string | null
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
          return (
            <ListItem
              key={member.userId}
              selected={!!existing && existing.id === activeId}
              onClick={() => (existing ? onSelect(existing.id) : onOpenDm(member.userId))}
            >
              <Avatar size="sm">
                <AvatarFallback colorKey={member.userId}>{initials(label)}</AvatarFallback>
              </Avatar>
              <Prim.Text fontSize="$sm" marginLeft="$1.5" flex={1} minWidth={0}>
                {label}
              </Prim.Text>
            </ListItem>
          )
        })}
      </Prim.Col>
    </Prim.Col>
  )
}

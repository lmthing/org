/**
 * The channel header (which doubles as the app bar) and the rail beside the
 * conversation.
 *
 * The rail holds ONE thing at a time — a thread or an app. Two rails would leave
 * the conversation about a third of the width, and the conversation is the point
 * of the surface; an app that is not currently open is one click away in the
 * header, which is cheap. Opening a thread therefore swaps an app out rather
 * than stacking beside it.
 */

import * as Prim from '@lmthing/ui/elements/primitives'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Separator } from '@lmthing/ui/elements/content/separator'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from '@lmthing/ui/elements/overlays/dropdown'
import { AppWindow, ExternalLink, Hash, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { appUrl, type Channel, type DirectoryProject } from '@/lib/team-pod'

/** The rail's width, in px, clamped so neither pane can be squeezed to nothing. */
const RAIL_MIN = 320
const RAIL_MAX = 900
const RAIL_DEFAULT = 420

/** What the rail is showing. */
export type Rail =
  | { kind: 'thread'; threadId: string }
  | { kind: 'app'; projectId: string }
  | null

export function ChannelHeader({
  channel,
  title,
  subtitle,
  projects,
  rail,
  isEditor,
  onOpenApp,
  onAttachApp,
  onDetachApp,
}: {
  channel: Channel | undefined
  title: string
  subtitle?: string
  projects: DirectoryProject[]
  rail: Rail
  isEditor: boolean
  onOpenApp: (projectId: string) => void
  onAttachApp: (projectId: string) => void
  onDetachApp: (projectId: string) => void
}) {
  const attached = channel?.apps ?? []
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  const attachable = projects.filter((p) => p.hasApp && !attached.includes(p.id))

  return (
    <Prim.Row
      alignItems="center"
      gap="$2"
      paddingHorizontal="$4"
      paddingVertical="$2"
      borderBottomWidth={1}
      borderColor="$border"
      flexShrink={0}
    >
      <Prim.Row alignItems="baseline" gap="$2" flexShrink={0}>
        {channel?.kind === 'dm' ? null : <Hash size={16} aria-hidden={true} />}
        <Prim.Text fontSize="$base" fontWeight="$semibold">
          {title}
        </Prim.Text>
        {subtitle ? <Caption>{subtitle}</Caption> : null}
      </Prim.Row>

      {attached.length ? (
        <Prim.Box height="$5">
          <Separator orientation="vertical" />
        </Prim.Box>
      ) : null}

      {/* The app bar. Attachment is a visible property of the channel here,
          rather than something to be found behind a menu. */}
      <Prim.Row alignItems="center" gap="$1" flex={1} minWidth={0} overflow="auto">
        {attached.map((projectId) => {
          const open = rail?.kind === 'app' && rail.projectId === projectId
          return (
            <Prim.Row
              key={projectId}
              alignItems="center"
              gap="$1"
              paddingLeft="$2"
              paddingRight={isEditor ? '$1' : '$2'}
              paddingVertical="$1"
              borderRadius="$radius-md"
              borderWidth={1}
              borderColor={open ? '$primary' : '$border'}
              backgroundColor={open ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent'}
              cursor="pointer"
              onClick={() => onOpenApp(projectId)}
            >
              <AppWindow size={12} aria-hidden={true} />
              <Prim.Text fontSize="$xs" fontWeight="$medium" whiteSpace="nowrap">
                {nameOf(projectId)}
              </Prim.Text>
              {isEditor ? (
                <Prim.Pressable
                  aria-label={`Unpin ${nameOf(projectId)}`}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    onDetachApp(projectId)
                  }}
                  display="flex"
                  alignItems="center"
                  opacity={0.6}
                  hoverStyle={{ opacity: 1 }}
                >
                  <X size={11} aria-hidden={true} />
                </Prim.Pressable>
              ) : null}
            </Prim.Row>
          )
        })}

      </Prim.Row>

      {/* Outside the scrolling strip above: with many apps pinned, a "+" that
          scrolled away with the tabs would be unreachable exactly when it is
          most needed. */}
      {isEditor && attachable.length ? (
        <Dropdown>
          <DropdownTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Pin an app to this channel">
              <Plus size={14} aria-hidden={true} />
            </Button>
          </DropdownTrigger>
          <DropdownContent>
            {attachable.map((project) => (
              <DropdownItem key={project.id} onClick={() => onAttachApp(project.id)}>
                {project.name}
              </DropdownItem>
            ))}
          </DropdownContent>
        </Dropdown>
      ) : null}
    </Prim.Row>
  )
}

/**
 * The rail itself: a resizable column with a drag handle on its left edge.
 *
 * Width is remembered for the session but not persisted to the pod — it is a
 * property of this screen, not of the team.
 */
export function RailPane({
  title,
  icon,
  onClose,
  children,
  headerExtra,
}: {
  title: string
  icon?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  headerExtra?: React.ReactNode
}) {
  const [width, setWidth] = useState(RAIL_DEFAULT)
  const dragging = useRef(false)

  const onMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    // The rail is anchored to the right edge, so its width is whatever is to the
    // right of the pointer.
    setWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, window.innerWidth - e.clientX)))
  }, [])

  useEffect(() => {
    const stop = () => {
      dragging.current = false
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
      stop()
    }
  }, [onMove])

  return (
    <Prim.Row height="100%" flexShrink={0} width={width}>
      <Prim.Box
        width={5}
        flexShrink={0}
        cursor="col-resize"
        backgroundColor="$border"
        opacity={0.5}
        hoverStyle={{ opacity: 1, backgroundColor: '$primary' }}
        onMouseDown={() => {
          dragging.current = true
          // Without this a drag selects the transcript text it passes over.
          document.body.style.userSelect = 'none'
        }}
      />
      <Prim.Col flex={1} minWidth={0} height="100%">
        <Prim.Row
          alignItems="center"
          gap="$2"
          paddingHorizontal="$3"
          paddingVertical="$2"
          borderBottomWidth={1}
          borderColor="$border"
          flexShrink={0}
        >
          {icon}
          <Prim.Text fontSize="$sm" fontWeight="$semibold" flex={1} minWidth={0}>
            {title}
          </Prim.Text>
          {headerExtra}
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
            <X size={14} aria-hidden={true} />
          </Button>
        </Prim.Row>
        {children}
      </Prim.Col>
    </Prim.Row>
  )
}

/**
 * A project's app, running beside the conversation.
 *
 * An iframe rather than a mounted component: a project app is a separately built
 * bundle served by the pod at its own URL with its own router, and the pod
 * already serves it that way for `lmthing.app`. Rendering it inline would mean a
 * second copy of the app runtime inside this SPA.
 */
export function AppFrame({ projectId, name }: { projectId: string; name: string }) {
  return (
    <Prim.Box flex={1} minHeight={0} backgroundColor="$background">
      {/* A real `<iframe>`: `Prim.Box`'s `as` is a closed set of semantic block
          tags, and nothing in the design system wraps an embedded document. The
          inline style carries only layout — no color crosses this boundary. */}
      <iframe
        src={appUrl(projectId)}
        title={name}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      />
    </Prim.Box>
  )
}

/** "Open in a full tab" — for the app the rail is currently showing. */
export function OpenAppExternally({ projectId }: { projectId: string }) {
  return (
    <Prim.Link
      href={appUrl(projectId)}
      target="_blank"
      rel="noreferrer"
      display="flex"
      alignItems="center"
      opacity={0.7}
      hoverStyle={{ opacity: 1 }}
      aria-label="Open in a new tab"
    >
      <ExternalLink size={14} aria-hidden={true} />
    </Prim.Link>
  )
}

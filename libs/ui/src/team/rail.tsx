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

import * as Prim from '../elements/primitives/index'
import { Button } from '../elements/forms/button'
import { Caption } from '../elements/typography/caption'
import { Separator } from '../elements/content/separator'
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from '../elements/overlays/dropdown'
import {
  AppIcon,
  ChevronLeftIcon,
  CloseIcon,
  ExternalLinkIcon,
  HashIcon,
  MenuIcon,
  PlusIcon,
} from './icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Channel, DirectoryProject, Rail } from './types'
import { AppView } from '../elements/content/app-view'

/** The rail's width, in px, clamped so neither pane can be squeezed to nothing. */
const RAIL_MIN = 320
const RAIL_MAX = 900
const RAIL_DEFAULT = 420

export function ChannelHeader({
  channel,
  title,
  subtitle,
  projects,
  rail,
  isEditor,
  compact,
  onOpenMenu,
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
  /** Compact: the sidebar is behind a menu button rather than always on screen. */
  compact?: boolean
  onOpenMenu?: () => void
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
      {compact ? (
        <Button size="icon" variant="ghost" onClick={onOpenMenu} aria-label="Channels">
          <MenuIcon size={16} />
        </Button>
      ) : null}
      <Prim.Row alignItems="baseline" gap="$2" flexShrink={0} minWidth={0}>
        {channel?.kind === 'dm' ? null : <HashIcon size={16} />}
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
              <AppIcon size={12} />
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
                  <CloseIcon size={11} />
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
              <PlusIcon size={14} />
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
  compact,
  backLabel,
}: {
  title: string
  icon?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  headerExtra?: React.ReactNode
  /** Compact: the rail covers the surface instead of sitting beside it. */
  compact?: boolean
  /** Where closing returns to — named, and shown as a back row when the rail covers the screen. */
  backLabel?: string
}) {
  const [width, setWidth] = useState(RAIL_DEFAULT)
  const dragging = useRef(false)

  const onMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return
    // The rail is anchored to the right edge, so its width is whatever is to the
    // right of the pointer.
    const viewport = globalThis.window?.innerWidth
    if (viewport === undefined) return
    setWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, viewport - e.clientX)))
  }, [])

  // Drag-to-resize is a MOUSE affordance, and the handle below only renders when the rail sits
  // beside the conversation (`!compact`) — which a phone never is. The listeners, though, were
  // being attached on every mount regardless, so the native target ran `window.addEventListener`
  // on a global that has no such method and took the surface down before anything drew. There is
  // nothing to port here: a touch device resizes by opening and closing the rail.
  useEffect(() => {
    const win = globalThis.window
    if (!win?.addEventListener) return
    const stop = () => {
      dragging.current = false
      const body = globalThis.document?.body
      if (body) body.style.userSelect = ''
    }
    win.addEventListener('mousemove', onMove)
    win.addEventListener('mouseup', stop)
    return () => {
      win.removeEventListener('mousemove', onMove)
      win.removeEventListener('mouseup', stop)
      stop()
    }
  }, [onMove])

  return (
    <Prim.Row
      height="100%"
      flexShrink={0}
      {...(compact
        ? // Covering the surface, not sitting beside it. There is no room for two
          // panes on a phone, and a 320px-minimum rail next to a 320px
          // conversation is two unusable columns rather than one usable one.
          ({
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 30,
            backgroundColor: '$background',
          } as const)
        : { width })}
    >
      {compact ? null : (
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
            const body = globalThis.document?.body
            if (body) body.style.userSelect = 'none'
          }}
        />
      )}
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
          {/* Covering the screen, the rail is a PLACE you went into, so it gets the affordance a
              place gets: a back control on the left, naming what it returns to. A lone `×` in the
              top-right is both the least reachable corner one-handed and no answer at all to "where
              does this put me back". Beside the conversation it is a panel, not a place, and the
              close button on the right is right. */}
          {compact ? (
            <Prim.Pressable
              onClick={onClose}
              display="flex"
              flexDirection="row"
              alignItems="center"
              gap="$1"
              marginLeft="-$1"
              paddingVertical="$1"
              paddingHorizontal="$1"
              borderRadius="$radius-md"
              flexShrink={0}
              pressStyle={{ opacity: 0.6 }}
              hoverStyle={{ backgroundColor: '$muted' }}
              aria-label={backLabel ? `Back to ${backLabel}` : 'Back'}
            >
              <ChevronLeftIcon size={16} />
              {backLabel ? (
                <Prim.Text fontSize="$sm" color="$muted-foreground" maxWidth={110} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  {backLabel}
                </Prim.Text>
              ) : null}
            </Prim.Pressable>
          ) : null}
          {icon}
          <Prim.Text
            fontSize="$sm"
            fontWeight="$semibold"
            flex={1}
            minWidth={0}
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {title}
          </Prim.Text>
          {headerExtra}
          {compact ? null : (
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
              <CloseIcon size={14} />
            </Button>
          )}
        </Prim.Row>
        {children}
      </Prim.Col>
    </Prim.Row>
  )
}

/**
 * The app pane: the URL is supplied by the caller, because where a project's
 * pages live differs per target (a path on web, an absolute pod URL on native)
 * and this component has no business knowing which one it is on.
 */
export function AppFrame({ url, name }: { url: string; name: string }) {
  return <AppView url={url} title={name} />
}

/** "Open in a full tab" — for the app the rail is currently showing. */
export function OpenAppExternally({ url }: { url: string }) {
  return (
    <Prim.Link
      href={url}
      target="_blank"
      rel="noreferrer"
      display="flex"
      alignItems="center"
      opacity={0.7}
      hoverStyle={{ opacity: 1 }}
      aria-label="Open in a new tab"
    >
      <ExternalLinkIcon size={14} />
    </Prim.Link>
  )
}

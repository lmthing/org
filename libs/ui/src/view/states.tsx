/**
 * Loading, empty and error — the RENDERER DEFAULTS, and 31% of the whole win.
 *
 * The audit found **26 of 153 hand-built components** (~1,050 LOC) across five apps were
 * skeletons, spinners, empty states and error notes — and three of its five mapping
 * passes independently proposed adding a `skeleton` element. All three were wrong. These
 * states are supplied here, and there is deliberately **no way to author one**: no
 * `skeleton`, no `spinner`, no `loading`, no `error` in the element catalogue.
 *
 * `empty` is the single exception, and it is an OVERRIDE, not an authored state — a way
 * to say something better than a default that always exists ("No expenses yet · Add the
 * first one" beats "Nothing here"). A section that omits it still gets one.
 *
 * Everything here is built from `Prim.*` so it draws identically on both targets, and
 * every string sits inside a `Prim.Text` — a bare string in a View is silently DROPPED on
 * React Native, which for a loading state would mean a phone showing an empty box where
 * the web shows "Loading…".
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import { ViewIcon } from './icons'
import type { IconName } from './types'

/** How much room a placeholder should claim while the real content is in flight. */
export type SkeletonShape = 'rows' | 'cards' | 'block' | 'line' | 'stat'

const BAR = {
  backgroundColor: '$muted',
  borderRadius: '$radius',
  opacity: 0.6,
} as const

function Bar({ width, height = 12 }: { width: number | string; height?: number }) {
  return <Prim.Box {...BAR} width={width} height={height} />
}

/**
 * The default loading state.
 *
 * A shaped placeholder rather than a spinner: the shipped apps' own skeletons were shaped
 * (`ListingCardSkeleton`, `FeedSkeleton`, `SkeletonRow`), because a block that already
 * looks like the answer stops the page jumping when the answer lands. `shape` is derived
 * by the SECTION from what it is about to draw — it is never authored.
 */
export function LoadingState({ shape = 'rows', count = 3 }: { shape?: SkeletonShape; count?: number }) {
  if (shape === 'line') return <Bar width="40%" />
  if (shape === 'stat') {
    return (
      <Prim.Row gap="$3" flexWrap="wrap" aria-busy={true}>
        {Array.from({ length: count }, (_, i) => (
          <Prim.Col
            key={i}
            gap="$2"
            padding="$4"
            borderWidth={1}
            borderColor="$border"
            borderRadius="$radius-lg"
            backgroundColor="$card"
            minWidth={140}
            flexGrow={1}
          >
            <Bar width="50%" height={10} />
            <Bar width="70%" height={20} />
          </Prim.Col>
        ))}
      </Prim.Row>
    )
  }
  if (shape === 'block') {
    return (
      <Prim.Col gap="$2" aria-busy={true}>
        <Bar width="90%" />
        <Bar width="100%" />
        <Bar width="75%" />
      </Prim.Col>
    )
  }
  const card = shape === 'cards'
  return (
    <Prim.Col gap="$3" aria-busy={true}>
      {Array.from({ length: count }, (_, i) => (
        <Prim.Col
          key={i}
          gap="$2"
          {...(card
            ? {
                padding: '$4',
                borderWidth: 1,
                borderColor: '$border',
                borderRadius: '$radius-lg',
                backgroundColor: '$card',
              }
            : { paddingVertical: '$2' })}
        >
          <Bar width="60%" height={14} />
          <Bar width="85%" height={10} />
        </Prim.Col>
      ))}
    </Prim.Col>
  )
}

/**
 * The default error state.
 *
 * Names what failed and offers a retry. The five apps' hand-written `ErrorNote`/
 * `ErrorState` did exactly this and nothing more; the one thing they all got right and
 * that a generated app must not lose is the RETRY — a transient 502 on a pod that just
 * woke should not need a page reload.
 */
export function ErrorState({
  message,
  onRetry,
  title = 'Something went wrong',
}: {
  message?: string
  onRetry?: () => void
  title?: string
}) {
  return (
    <Prim.Col
      gap="$2"
      padding="$4"
      borderWidth={1}
      borderColor="$border"
      borderRadius="$radius-lg"
      backgroundColor="$card"
      role="alert"
    >
      <Prim.Row gap="$2" alignItems="center">
        <ViewIcon name="alert" tone="danger" />
        <Prim.Text fontWeight="$semibold" color="$destructive">
          {title}
        </Prim.Text>
      </Prim.Row>
      {message ? (
        <Prim.Text fontSize="$sm" color="$muted-foreground">
          {message}
        </Prim.Text>
      ) : null}
      {onRetry ? (
        <Prim.Pressable
          onClick={onRetry}
          alignSelf="flex-start"
          paddingHorizontal="$3"
          paddingVertical="$1.5"
          borderRadius="$radius-md"
          borderWidth={1}
          borderColor="$border"
          backgroundColor="$background"
        >
          <Prim.Text fontSize="$sm">Try again</Prim.Text>
        </Prim.Pressable>
      ) : null}
    </Prim.Col>
  )
}

/**
 * The default empty state, and the surface a section's `empty:` override renders through.
 *
 * `message` is spelled `message` (not `text`) because the desk check reached for that key
 * 8 times out of 8 unprompted — measured evidence about what the model writes beats
 * internal consistency with `banner.text`.
 */
export function EmptyStateView({
  title = 'Nothing here yet',
  message,
  icon,
  action,
}: {
  title?: string
  message?: string
  icon?: IconName
  action?: React.ReactNode
}) {
  return (
    <Prim.Col
      gap="$2"
      alignItems="center"
      paddingVertical="$8"
      paddingHorizontal="$4"
      borderWidth={1}
      borderColor="$border"
      borderRadius="$radius-lg"
      borderStyle="dashed"
    >
      {icon ? <ViewIcon name={icon} size="lg" tone="neutral" /> : null}
      <Prim.Text fontWeight="$medium" color="$foreground" textAlign="center">
        {title}
      </Prim.Text>
      {message ? (
        <Prim.Text fontSize="$sm" color="$muted-foreground" textAlign="center">
          {message}
        </Prim.Text>
      ) : null}
      {action}
    </Prim.Col>
  )
}

/**
 * The "an agent is working on this" note — the presentation of `create.async`.
 *
 * `health/components/states.tsx`'s `AIWorking` already carried this exact copy. It is a
 * renderer default for the same reason the others are: it is chrome around a declared
 * fact (`async: { note, refetchAfter }`), not a decision the model should be making.
 */
export function PendingNote({ note }: { note?: string }) {
  return (
    <Prim.Row
      gap="$2"
      alignItems="center"
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderRadius="$radius-md"
      backgroundColor="$secondary"
      role="status"
    >
      <ViewIcon name="clock" size="sm" tone="info" />
      <Prim.Text fontSize="$sm" color="$muted-foreground">
        {note ?? 'Working on it — this page updates automatically.'}
      </Prim.Text>
    </Prim.Row>
  )
}

/** A single quiet line — used where a whole state block would be heavier than the content. */
export function InlineNote({ text }: { text: string }) {
  return (
    <Prim.Text fontSize="$sm" color="$muted-foreground">
      {text}
    </Prim.Text>
  )
}

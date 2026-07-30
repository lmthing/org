import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * A bar of tabs pinned to the bottom of the viewport — the phone's primary navigation.
 *
 * This is the general form of `nav/bottom-nav`, which is the app shell's own three tabs and now
 * delegates here. It exists because a SECOND set of tabs needed the same treatment: the team
 * workspace's Channels · Projects · Members · Settings lived in a top `TabBar` whose four tabs plus
 * a back link plus a role badge could not shrink below ~576px, so on a 390px phone the layout
 * viewport grew to fit them and the last two tabs sat off the right edge with no way to reach them.
 * A bottom bar solves both halves at once: four equal columns always fit, and they land where a
 * thumb already is.
 *
 * Rendering is by `display`, not by mounting — the caller decides visibility with `$md` overrides on
 * the wrapper if it wants the bar only on a phone.
 */

export interface BottomTab<Id extends string = string> {
  id: Id
  label: string
  /** Rendered at 20px inside the tab. Takes `size` like every icon in this package. */
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  /** A count to badge the tab with. 0 / undefined draws nothing. */
  badge?: number
  /** A quieter badge — "something is here" without a number (an unread channel). */
  dot?: boolean
}

export interface BottomTabsProps<Id extends string = string> {
  tabs: readonly BottomTab<Id>[]
  current: Id
  onSelect: (id: Id) => void
  className?: string
  /** Hide the bar at `md` and up, where a sidebar or a top tab strip does this job. */
  compactOnly?: boolean
  'aria-label'?: string
}

const BAR = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'stretch',
  flexShrink: 0,
  borderTopWidth: 1,
  borderColor: '$border',
  backgroundColor: '$card',
  // The home indicator is drawn OVER the app on a modern phone, and `viewport-fit=cover` in
  // `index.html` means the browser will not inset for us. Without this the last row of tabs sits
  // under the pill and the middle two are the only ones comfortably tappable.
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
} as const

const TAB = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$1',
  paddingVertical: '$2',
  // 44px is the smallest comfortable touch target; the icon + label already exceed it, this
  // guarantees it when a label is dropped.
  minHeight: 48,
} as const

const ICON_SIZE = 20

export function BottomTabs<Id extends string = string>({
  tabs,
  current,
  onSelect,
  className,
  compactOnly,
  'aria-label': ariaLabel = 'navigation',
}: BottomTabsProps<Id>) {
  return (
    <Prim.Box
      className={className}
      {...BAR}
      {...(compactOnly ? { $md: { display: 'none' } } : {})}
      aria-label={ariaLabel}
    >
      {tabs.map(({ id, label, icon: Icon, badge, dot }) => {
        const active = id === current
        return (
          <Prim.Pressable
            key={id}
            onClick={() => onSelect(id)}
            {...TAB}
            color={active ? '$primary' : '$muted-foreground'}
            // A tap that changes the screen should be acknowledged by the thing tapped, before the
            // screen it opens has drawn anything.
            pressStyle={{ opacity: 0.6 }}
            aria-label={label}
            title={label}
          >
            <Prim.Box position="relative">
              <Icon size={ICON_SIZE} aria-hidden={true} />
              {badge ? <TabBadge count={badge} /> : dot ? <TabDot /> : null}
            </Prim.Box>
            <Prim.Text fontSize="$xs" color={active ? '$primary' : '$muted-foreground'}>
              {label}
            </Prim.Text>
          </Prim.Pressable>
        )
      })}
    </Prim.Box>
  )
}

/** "12" over the tab's icon, capped so a busy team cannot widen the column. */
function TabBadge({ count }: { count: number }) {
  return (
    <Prim.Text
      position="absolute"
      top={-6}
      left={10}
      minWidth={16}
      height={16}
      paddingHorizontal="$1"
      borderRadius="$radius-full"
      backgroundColor="$primary"
      color="$primary-foreground"
      fontSize={10}
      fontWeight="$semibold"
      textAlign="center"
      lineHeight="16px"
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      {count > 99 ? '99+' : String(count)}
    </Prim.Text>
  )
}

/** Unread, but not addressed to you — a dot says "look here" without claiming a number. */
function TabDot() {
  return (
    <Prim.Box
      position="absolute"
      top={-2}
      left={14}
      width={8}
      height={8}
      borderRadius="$radius-full"
      backgroundColor="$primary"
    />
  )
}

import * as React from 'react'
import * as Prim from '../../primitives/index'
import { Home, Sparkles, Users } from '../../primitives/icons'

/**
 * The mobile tab bar — Home · Chat · Teams.
 *
 * ## Why it is responsive rather than native-only
 *
 * A bar pinned to the bottom of the viewport is the right answer on a phone and the wrong one in a
 * wide browser window, where the sidebar already does this job and a floating bar would just eat a
 * row of content. So this is ONE component that renders below the `md` breakpoint and disappears
 * above it — not a `.native` fork. A fork would make "how do I get to Home?" a question with two
 * different answers living in two files, and the repo's whole native story is that a screen may not
 * do that (see `docs/mobile-native-chat-CONTINUE.md`).
 *
 * Base styles ARE the phone styles here — `$md` is min-width 768, so the `$md` block is the desktop
 * override. That is the same convention the chat header uses to hide its workbench controls.
 */

export type BottomNavTab = 'home' | 'chat' | 'teams'

export interface BottomNavProps {
  current: BottomNavTab
  onSelect: (tab: BottomNavTab) => void
  className?: string
}

const TABS: { id: BottomNavTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'chat', label: 'Chat', icon: Sparkles },
  { id: 'teams', label: 'Teams', icon: Users },
]

const BAR = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'stretch',
  flexShrink: 0,
  borderTopWidth: 1,
  borderColor: '$border',
  backgroundColor: '$card',
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
} as const

const ICON_SIZE = 20

export function BottomNav({ current, onSelect, className }: BottomNavProps) {
  return (
    <Prim.Box className={className} {...BAR} $md={{ display: 'none' }} aria-label="main navigation">
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = id === current
        return (
          <Prim.Pressable
            key={id}
            onClick={() => onSelect(id)}
            {...TAB}
            color={active ? '$primary' : '$muted-foreground'}
            aria-label={label}
            title={label}
          >
            <Icon size={ICON_SIZE} aria-hidden={true} />
            <Prim.Text fontSize="$xs" color={active ? '$primary' : '$muted-foreground'}>
              {label}
            </Prim.Text>
          </Prim.Pressable>
        )
      })}
    </Prim.Box>
  )
}

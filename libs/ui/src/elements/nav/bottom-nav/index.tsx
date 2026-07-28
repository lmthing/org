import * as React from 'react'
import { Home, Sparkles, Users } from '../../primitives/icons'
import { BottomTabs, type BottomTab } from '../bottom-tabs/index'

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
 * The bar itself is `nav/bottom-tabs`, which the team workspace also uses for its own four tabs.
 * This file is now only the app shell's THREE — the tabs, not the bar.
 */

export type BottomNavTab = 'home' | 'chat' | 'teams'

export interface BottomNavProps {
  current: BottomNavTab
  onSelect: (tab: BottomNavTab) => void
  className?: string
  /** Unread badges, by tab. A tab with no entry is drawn plain. */
  badges?: Partial<Record<BottomNavTab, number>>
}

const TABS: readonly BottomTab<BottomNavTab>[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'chat', label: 'Chat', icon: Sparkles },
  { id: 'teams', label: 'Teams', icon: Users },
]

export function BottomNav({ current, onSelect, className, badges }: BottomNavProps) {
  const tabs = React.useMemo(
    () => TABS.map((tab) => ({ ...tab, ...(badges?.[tab.id] ? { badge: badges[tab.id] } : {}) })),
    [badges],
  )
  return (
    <BottomTabs
      tabs={tabs}
      current={current}
      onSelect={onSelect}
      {...(className !== undefined ? { className } : {})}
      compactOnly
      aria-label="main navigation"
    />
  )
}

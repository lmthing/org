import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * TabBar — the idiomatic `.tab-bar`. Renders `Prim.Box` / `Prim.Pressable` (a real `<button>` at
 * runtime via `createComponent`) with the styling as `$`-token PROPS from tab-bar.styled.tsx
 * (docs/tamagui-idiomatic-migration.md §4). `tab-bar/index.css` is deleted.
 * (`transition-colors` awaits the animation driver, §5/P4.)
 */
export interface TabBarTab {
  id: string
  label: React.ReactNode
}

export interface TabBarProps extends React.ComponentProps<'div'> {
  tabs: TabBarTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
}

/** `.tab-bar` — flex, items-center, gap-1, border-b. */
const TAB_BAR = {
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
} as const

/** `.tab-bar__tab` — the inactive tab: transparent 2px underline, muted text, hover to foreground. */
const TAB = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '$1.5',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  fontSize: '$sm',
  color: '$muted-foreground',
  borderTopWidth: 0,
  borderRightWidth: 0,
  borderLeftWidth: 0,
  borderBottomWidth: 2,
  borderBottomColor: 'transparent',
  marginBottom: -1, // -mb-px, so the 2px underline overlaps the bar's 1px bottom border
  backgroundColor: 'transparent',
  cursor: 'pointer',
  hoverStyle: { color: '$foreground' },
} as const

/** `.tab-bar__tab--active` — foreground text on a primary underline. */
const TAB_ACTIVE = {
  color: '$foreground',
  borderBottomColor: '$primary',
  fontWeight: '$medium',
} as const

function TabBar({ tabs, activeTab, onTabChange, ...props }: TabBarProps) {
  return (
    <Prim.Box {...TAB_BAR} role="tablist" {...(props as Record<string, unknown>)}>
      {tabs.map((tab) => (
        <Prim.Pressable
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          {...TAB}
          {...(activeTab === tab.id ? TAB_ACTIVE : {})}
          onClick={() => onTabChange?.(tab.id)}
        >
          {tab.label}
        </Prim.Pressable>
      ))}
    </Prim.Box>
  )
}

export { TabBar }

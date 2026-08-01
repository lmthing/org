import * as React from 'react'
import * as Prim from '../../primitives/index'
import { labelled } from '../../primitives/labelled'

/**
 * TabBar — the idiomatic `.tab-bar`. Renders `Prim.Box` / `Prim.Pressable` (a real `<button>` at
 * runtime via `createComponent`) with the styling as `$`-token PROPS transcribed from its retired `styled()` proof
 * (docs/tamagui-idiomatic-migration.md §4). `tab-bar/index.css` is deleted.
 * `transition-colors` is the driver's `transition="quick"`.
 */
export interface TabBarTab {
  id: string
  label: React.ReactNode
}

// `Prim.*StyleProps` too: the body spreads props straight onto a Tamagui primitive, so style props
// have always WORKED here — they just could not be typed, which is what forced callers into `style`.
export interface TabBarProps extends React.ComponentProps<'div'>, Prim.LayoutStyleProps, Prim.BoxStyleProps, Prim.MarginStyleProps, Prim.TextStyleProps {
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
  transition: 'quick', animateOnly: ['color', 'background-color', 'border-color'],
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
          {/*
            `tab.label` is `React.ReactNode`, not always a plain string — but every caller in this
            codebase passes a string (`SubjectList`'s `label: f.slug`, `AgentBuilder`'s tab names),
            so on native this was the same class of drop the AST gate catches for a LITERAL child:
            `Prim.Pressable` is a View with no cascade to a bare string. `labelled()` is the right
            tool precisely because the type is `ReactNode` — it wraps a string/number and passes
            anything else (an icon a caller might one day pass) through untouched. `color`/
            `fontSize`/`fontWeight` are `TAB`'s own defaults, resolved through the SAME active/idle
            branch the tab's own background/underline already use — see `primitives/labelled.tsx`.
          */}
          {labelled(tab.label, {
            color: (activeTab === tab.id ? TAB_ACTIVE.color : TAB.color) as Prim.TextProps['color'],
            fontSize: TAB.fontSize as Prim.TextProps['fontSize'],
            fontWeight: (activeTab === tab.id ? TAB_ACTIVE.fontWeight : undefined) as Prim.TextProps['fontWeight'],
          })}
        </Prim.Pressable>
      ))}
    </Prim.Box>
  )
}

export { TabBar }

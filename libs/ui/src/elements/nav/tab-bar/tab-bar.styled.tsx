/**
 * tab-bar.styled.tsx — P2 composite conversion of the `.tab-bar` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/nav/tab-bar/index.css —
 * the `.tab-bar` row + `.tab-bar__tab` and its `--active` modifier — into idiomatic Tamagui
 * `styled()` frames.
 *
 * `transition-colors` awaits the animation driver (§5/P4). Lands alongside the shipped className
 * TabBar (index.tsx); tab-bar-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/** `.tab-bar` — flex, items-center, gap-1, border-b, border-border. */
export const TabBarFrame = styled(View, {
  name: 'TabBar',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/**
 * `.tab-bar__tab` — inline-flex, items-center, gap-1.5, px-3, py-2, text-sm, text-muted-foreground,
 * border-b-2, border-transparent, -mb-px, hover:text-foreground, cursor-pointer + the `active` variant
 * (text-foreground, border-primary, font-medium).
 */
export const TabBarTabFrame = styled(View, {
  name: 'TabBarTab',
  tag: 'button',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '$1.5',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  fontSize: '$sm',
  color: '$muted-foreground',
  borderBottomWidth: 2,
  borderBottomColor: 'transparent',
  marginBottom: -1, // -mb-px, so the 2px underline overlaps the bar's 1px bottom border
  cursor: 'pointer',
  borderLeftWidth: 0,
  borderRightWidth: 0,
  borderTopWidth: 0,
  backgroundColor: 'transparent',
  hoverStyle: { color: '$foreground' },

  variants: {
    active: {
      true: { color: '$foreground', borderBottomColor: '$primary', fontWeight: '$medium' },
    },
  } as const,
})

export interface TabBarTabData {
  id: string
  label: React.ReactNode
}

export interface StyledTabBarProps extends React.ComponentProps<'div'> {
  tabs: TabBarTabData[]
  activeTab?: string
  onTabChange?: (id: string) => void
}

const Frame = TabBarFrame as unknown as React.ComponentType<any>
const Tab = TabBarTabFrame as unknown as React.ComponentType<any>

/** Idiomatic TabBar — same public API as the shipped className TabBar (`tabs`/`activeTab`/`onTabChange`). */
export function StyledTabBar({ tabs, activeTab, onTabChange, ...props }: StyledTabBarProps) {
  return (
    <Frame role="tablist" {...props}>
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          active={activeTab === tab.id}
          onPress={() => onTabChange?.(tab.id)}
        >
          {tab.label}
        </Tab>
      ))}
    </Frame>
  )
}

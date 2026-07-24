/**
 * top-bar.styled.tsx — P2 composite conversion of the `.top-bar` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/nav/top-bar/index.css —
 * the `.top-bar` header + the `.top-bar__title`/`__actions` parts — into idiomatic Tamagui `styled()`
 * frames.
 *
 * Lands alongside the shipped className TopBar (index.tsx); top-bar-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View, Text } from '../../../theme/tamagui-web.config'

/** `.top-bar` — flex, items-center, justify-between, h-12, px-4, border-b, border-border, bg-background. */
export const TopBarFrame = styled(View, {
  name: 'TopBar',
  tag: 'header',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: '$12',
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  backgroundColor: '$background',
})

/** `.top-bar__title` — text-sm, font-semibold, text-foreground, truncate. */
export const TopBarTitleFrame = styled(Text, {
  name: 'TopBarTitle',
  tag: 'span',
  fontSize: '$sm',
  fontWeight: '$semibold',
  color: '$foreground',
  // truncate = overflow-hidden + text-ellipsis + whitespace-nowrap
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.top-bar__actions` — flex, items-center, gap-2. */
export const TopBarActionsFrame = styled(View, {
  name: 'TopBarActions',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

export interface StyledTopBarProps extends Omit<React.ComponentProps<'header'>, 'title'> {
  title?: React.ReactNode
  actions?: React.ReactNode
}

const Frame = TopBarFrame as unknown as React.ComponentType<any>
const Title = TopBarTitleFrame as unknown as React.ComponentType<any>
const Actions = TopBarActionsFrame as unknown as React.ComponentType<any>

/** Idiomatic TopBar — same public API as the shipped className TopBar (`title`/`actions`). */
export function StyledTopBar({ title, actions, children, ...props }: StyledTopBarProps) {
  return (
    <Frame {...props}>
      {title != null && <Title>{title}</Title>}
      {children}
      {actions != null && <Actions>{actions}</Actions>}
    </Frame>
  )
}

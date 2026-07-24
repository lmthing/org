/** studio-shell.styled.tsx — P2 conversion of the `.studio-shell` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className shell. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.studio-shell` — full-viewport-height shell. */
export const StudioShellFrame = styled(View, {
  name: 'StudioShell',
  height: '100vh',
})

/** `.studio-shell__empty` — centered empty state. */
export const StudioShellEmptyFrame = styled(View, {
  name: 'StudioShellEmpty',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})

/** `.studio-shell__empty-content` — dim centered content wrapper. */
export const StudioShellEmptyContentFrame = styled(View, {
  name: 'StudioShellEmptyContent',
  textAlign: 'center',
  opacity: 0.5,
})

/** `.studio-shell__empty-title` — semibold text-lg (1.125rem) title. */
export const StudioShellEmptyTitleFrame = styled(Text, {
  name: 'StudioShellEmptyTitle',
  fontSize: '$lg',
  fontWeight: '$semibold',
  marginBottom: '$2',
})

/** `.studio-shell__empty-subtitle` — text-sm subtitle. */
export const StudioShellEmptySubtitleFrame = styled(Text, {
  name: 'StudioShellEmptySubtitle',
  fontSize: '$sm',
})

export interface StyledStudioShellProps extends React.ComponentProps<'div'> {}

const Frame = StudioShellFrame as unknown as React.ComponentType<any>

/** Idiomatic StudioShell — same public API as the shipped className shell. */
export function StyledStudioShell({ ...props }: StyledStudioShellProps) {
  return <Frame {...props} />
}

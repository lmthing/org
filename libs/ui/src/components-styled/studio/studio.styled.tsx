/** studio.styled.tsx — P2 conversion of the `.studio-list` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className studio. */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.studio-list__header` — space-between, items-center header row. */
export const StudioListHeaderFrame = styled(View, {
  name: 'StudioListHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/** `.studio-list__empty` — centered flex-col empty state with p-12 (3rem). */
export const StudioListEmptyFrame = styled(View, {
  name: 'StudioListEmpty',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$12',
})

export interface StyledStudioListHeaderProps extends React.ComponentProps<'div'> {}
export interface StyledStudioListEmptyProps extends React.ComponentProps<'div'> {}

const Header = StudioListHeaderFrame as unknown as React.ComponentType<any>
const Empty = StudioListEmptyFrame as unknown as React.ComponentType<any>

/** Idiomatic StudioListHeader — same public API as the shipped className header. */
export function StyledStudioListHeader({ ...props }: StyledStudioListHeaderProps) {
  return <Header {...props} />
}
/** Idiomatic StudioListEmpty — same public API as the shipped className empty state. */
export function StyledStudioListEmpty({ ...props }: StyledStudioListEmptyProps) {
  return <Empty {...props} />
}

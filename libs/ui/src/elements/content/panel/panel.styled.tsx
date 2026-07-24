/**
 * panel.styled.tsx — P2 leaf conversion of the `.panel` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/content/panel/index.css —
 * the `.panel` base + `.panel--split` and the `.panel__header`/`__body` parts — into idiomatic
 * Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors and SPIKE-B scales.
 *
 * Lands alongside the shipped className Panel (index.tsx); panel-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.panel` base (flex, flex-col, bg-background, border-border, rounded-md, overflow-hidden) + the
 * `split` variant (`.panel--split` = flex-row).
 */
export const PanelFrame = styled(View, {
  name: 'Panel',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '$background',
  borderWidth: 1,
  borderColor: '$border',
  borderRadius: '$radius-md',
  overflow: 'hidden',

  variants: {
    split: {
      true: { flexDirection: 'row' },
    },
  } as const,
})

/**
 * `.panel__header` — flex, items-center, justify-between, px-4, py-2, border-b, border-border,
 * text-sm, font-medium, text-foreground.
 */
export const PanelHeaderFrame = styled(View, {
  name: 'PanelHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: '$4',
  paddingVertical: '$2',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  fontSize: '$sm',
  fontWeight: '$medium',
  color: '$foreground',
})

/** `.panel__body` — flex-1, overflow-auto, p-4. */
export const PanelBodyFrame = styled(View, {
  name: 'PanelBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'auto',
  padding: '$4',
})

export interface StyledPanelProps extends React.ComponentProps<'div'> {
  split?: boolean
}

const Frame = PanelFrame as unknown as React.ComponentType<any>
const Header = PanelHeaderFrame as unknown as React.ComponentType<any>
const Body = PanelBodyFrame as unknown as React.ComponentType<any>

/** Idiomatic Panel family — same public API as the shipped className Panel (`split`). */
export function StyledPanel({ split, ...props }: StyledPanelProps) {
  return <Frame split={split} {...props} />
}
export const StyledPanelHeader = (props: React.ComponentProps<'div'>) => <Header {...props} />
export const StyledPanelBody = (props: React.ComponentProps<'div'>) => <Body {...props} />

/**
 * split-pane.styled.tsx — P2 composite conversion of the `.split-pane` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/layouts/split-pane/index.css
 * — the `.split-pane` base + the `.split-pane__primary`/`__secondary` parts — into idiomatic Tamagui
 * `styled()` frames.
 *
 * Lands alongside the shipped className SplitPane (index.tsx); split-pane-styled.test.tsx pins them.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/** `.split-pane` — flex, flex-row, h-full, overflow-hidden. */
export const SplitPaneFrame = styled(View, {
  name: 'SplitPane',
  display: 'flex',
  flexDirection: 'row',
  height: '100%',
  overflow: 'hidden',
})

/** `.split-pane__primary` — flex-1, overflow-auto. */
export const SplitPanePrimaryFrame = styled(View, {
  name: 'SplitPanePrimary',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'auto',
})

/** `.split-pane__secondary` — shrink-0, overflow-auto, border-l, border-border. */
export const SplitPaneSecondaryFrame = styled(View, {
  name: 'SplitPaneSecondary',
  flexShrink: 0,
  overflow: 'auto',
  borderLeftWidth: 1,
  borderLeftColor: '$border',
})

const Frame = SplitPaneFrame as unknown as React.ComponentType<any>
const Primary = SplitPanePrimaryFrame as unknown as React.ComponentType<any>
const Secondary = SplitPaneSecondaryFrame as unknown as React.ComponentType<any>

/** Idiomatic SplitPane family — same public API as the shipped className SplitPane. */
export const StyledSplitPane = (props: React.ComponentProps<'div'>) => <Frame {...props} />
export const StyledSplitPanePrimary = (props: React.ComponentProps<'div'>) => <Primary {...props} />
export const StyledSplitPaneSecondary = (props: React.ComponentProps<'div'>) => <Secondary {...props} />

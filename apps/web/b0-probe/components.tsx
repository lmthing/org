import { styled, View } from '@tamagui/core'
import './tamagui.config'

/**
 * B0 probe styled components. Each sets a box-model property that a Tailwind class
 * on the same element will try to override. The computed value tells us who wins.
 */

// Tamagui says align-items: stretch; className "items-center" says center.
export const AlignBox = styled(View, {
  name: 'AlignBox',
  alignItems: 'stretch',
})

// Tamagui base is flex-direction: column; className "flex-row" says row.
export const DirBox = styled(View, {
  name: 'DirBox',
})

// Tamagui says justify-content: flex-start; className "justify-end" says flex-end.
export const JustifyBox = styled(View, {
  name: 'JustifyBox',
  justifyContent: 'flex-start',
})

// Tamagui says display: flex (View default); className "hidden" (display:none) — extreme test.
export const DisplayBox = styled(View, {
  name: 'DisplayBox',
})

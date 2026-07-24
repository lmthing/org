/** ide-preview.styled.tsx — P2 conversion of the `.ide-preview` BEM block (docs §4).
 *  One styled() per BEM selector. Lands alongside the shipped className preview. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.ide-preview` — h-full, flex, flex-col, bg-background. */
export const IdePreviewFrame = styled(View, {
  name: 'IdePreview',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '$background',
})

/** `.ide-preview__header` — flex, items-center, gap-1.5, px-2, py-1.5, bg-card, border-b, border-border, shrink-0. */
export const IdePreviewHeaderFrame = styled(View, {
  name: 'IdePreviewHeader',
  display: 'flex',
  alignItems: 'center',
  gap: '$1.5',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
  backgroundColor: '$card',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  flexShrink: 0,
})

/**
 * `.ide-preview__refresh` — flex, items-center, justify-center, p-1, rounded, hover:bg-accent,
 * text-muted-foreground, hover:text-foreground, shrink-0. (transition-colors awaits the animation driver.)
 */
export const IdePreviewRefreshFrame = styled(View, {
  name: 'IdePreviewRefresh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$1',
  borderRadius: '$radius',
  color: '$muted-foreground',
  flexShrink: 0,
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: '$accent', color: '$foreground' },
})

/**
 * `.ide-preview__url` — flex-1, min-w-0, px-2, py-0.5, text-xs, bg-background, border, border-border,
 * rounded, font-mono, text-foreground, placeholder:text-muted-foreground, focus:outline-none,
 * focus:ring-1, focus:ring-primary. (ring maps to outline per §5.)
 */
export const IdePreviewUrlFrame = styled(View, {
  name: 'IdePreviewUrl',
  tag: 'input',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
  paddingHorizontal: '$2',
  paddingVertical: '$0.5',
  fontSize: '$xs',
  backgroundColor: '$background',
  borderWidth: 1,
  borderColor: '$border',
  borderRadius: '$radius',
  fontFamily: 'monospace',
  color: '$foreground',
  placeholderTextColor: '$muted-foreground',
  focusStyle: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: '$primary' },
})

/**
 * `.ide-preview__iframe` — flex-1, w-full, border-0, bg-white. `bg-white` is the literal white
 * keyword (an iframe backdrop, theme-independent — no white token exists).
 */
export const IdePreviewIframeFrame = styled(View, {
  name: 'IdePreviewIframe',
  tag: 'iframe',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  width: '100%',
  borderWidth: 0,
  backgroundColor: 'white',
})

/** `.ide-preview__loading` — flex-1, flex, items-center, justify-center, text-muted-foreground, text-sm. */
export const IdePreviewLoadingFrame = styled(Text, {
  name: 'IdePreviewLoading',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '$muted-foreground',
  fontSize: '$sm',
})

export interface StyledIdePreviewProps extends React.ComponentProps<'div'> {}

const Frame = IdePreviewFrame as unknown as React.ComponentType<any>
export function StyledIdePreview({ ...props }: StyledIdePreviewProps) {
  return <Frame {...props} />
}

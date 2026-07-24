/** ide-terminal.styled.tsx — P2 conversion of the `.ide-terminal` BEM block (docs §4).
 *  One styled() per BEM selector; the `__tab` `--active` and `__pane` `--hidden` modifiers become
 *  boolean variants. Lands alongside the shipped className terminal. */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.ide-terminal` — h-full, flex, flex-col, bg-background. */
export const IdeTerminalFrame = styled(View, {
  name: 'IdeTerminal',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '$background',
})

/** `.ide-terminal__tabs` — flex, items-stretch, bg-card, border-b, border-border, shrink-0, overflow-x-auto. */
export const IdeTerminalTabsFrame = styled(View, {
  name: 'IdeTerminalTabs',
  display: 'flex',
  alignItems: 'stretch',
  backgroundColor: '$card',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  flexShrink: 0,
  overflowX: 'auto',
})

/**
 * `.ide-terminal__tab` — flex, items-center, gap-1, px-3, py-1.5, text-xs, text-muted-foreground,
 * cursor-pointer, hover:bg-accent, hover:text-foreground, shrink-0, select-none, whitespace-nowrap +
 * the `--active` modifier as an `active` variant. (transition-colors awaits the animation driver.)
 */
export const IdeTerminalTabFrame = styled(View, {
  name: 'IdeTerminalTab',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  paddingHorizontal: '$3',
  paddingVertical: '$1.5',
  fontSize: '$xs',
  color: '$muted-foreground',
  cursor: 'pointer',
  flexShrink: 0,
  userSelect: 'none',
  whiteSpace: 'nowrap',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: '$accent', color: '$foreground' },

  variants: {
    active: {
      true: { backgroundColor: '$background', color: '$foreground' },
    },
  } as const,
})

/**
 * `.ide-terminal__tab-close` — flex, items-center, justify-center, rounded, w-4, h-4, opacity-50,
 * hover:opacity-100, hover:bg-muted/80 (alpha via color-mix). (transition-opacity awaits the driver.)
 */
export const IdeTerminalTabCloseFrame = styled(View, {
  name: 'IdeTerminalTabClose',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$radius',
  width: '$4',
  height: '$4',
  opacity: 0.5,
  // transition-opacity awaits the animation driver (§5/P4)
  hoverStyle: { opacity: 1, backgroundColor: 'color-mix(in srgb, var(--muted) 80%, transparent)' },
})

/**
 * `.ide-terminal__add` — flex, items-center, px-2, text-muted-foreground, hover:text-foreground,
 * hover:bg-accent, cursor-pointer. (transition-colors awaits the animation driver.)
 */
export const IdeTerminalAddFrame = styled(View, {
  name: 'IdeTerminalAdd',
  display: 'flex',
  alignItems: 'center',
  paddingHorizontal: '$2',
  color: '$muted-foreground',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { color: '$foreground', backgroundColor: '$accent' },
})

/** `.ide-terminal__body` — flex-1, min-h-0, relative. */
export const IdeTerminalBodyFrame = styled(View, {
  name: 'IdeTerminalBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minHeight: 0,
  position: 'relative',
})

/**
 * `.ide-terminal__pane` — absolute, inset-0 + the `--hidden` modifier (invisible, pointer-events-none)
 * as a `hidden` variant.
 */
export const IdeTerminalPaneFrame = styled(View, {
  name: 'IdeTerminalPane',
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,

  variants: {
    hidden: {
      true: { visibility: 'hidden', pointerEvents: 'none' },
    },
  } as const,
})

export interface StyledIdeTerminalProps extends React.ComponentProps<'div'> {}

const Frame = IdeTerminalFrame as unknown as React.ComponentType<any>
export function StyledIdeTerminal({ ...props }: StyledIdeTerminalProps) {
  return <Frame {...props} />
}

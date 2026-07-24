/**
 * terminal.styled.tsx — P2 composite conversion of the `.terminal` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/content/terminal/index.css
 * — the `.terminal` container + `.terminal--loading` and the `.terminal__viewport` — into idiomatic
 * Tamagui `styled()` frames. (Only the CHROME is converted; the xterm widget itself is a web-only
 * platform seam, index.web.tsx / §1.6, and mounts into the viewport frame.)
 *
 * Lands alongside the shipped className Terminal (index.web.tsx); terminal-styled.test.tsx pins them.
 */
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.terminal` container (flex, flex-col, w-full, h-full, bg-background, overflow-hidden, rounded-md)
 * + the `loading` variant (`.terminal--loading` = items-center, justify-center).
 */
export const TerminalFrame = styled(View, {
  name: 'Terminal',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  backgroundColor: '$background',
  overflow: 'hidden',
  borderRadius: '$radius-md',

  variants: {
    loading: {
      true: { alignItems: 'center', justifyContent: 'center' },
    },
  } as const,
})

/** `.terminal__viewport` — flex-1, min-h-0 (the xterm mount target). */
export const TerminalViewportFrame = styled(View, {
  name: 'TerminalViewport',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minHeight: 0,
})

/** logs-viewer.styled.tsx — P2 conversion of the `.computer-logs-viewer` BEM block (docs §4).
 *  One styled() per BEM selector; the `__message` `--warn/--error` modifiers become a `level`
 *  variant. Lands alongside the shipped className viewer. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.computer-logs-viewer` — flex, flex-col, h-full. */
export const ComputerLogsViewerFrame = styled(View, {
  name: 'ComputerLogsViewer',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
})

/** `.computer-logs-viewer__toolbar` — flex, items-center, gap-2, px-3, py-2, border-b, border-border. */
export const ComputerLogsViewerToolbarFrame = styled(View, {
  name: 'ComputerLogsViewerToolbar',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/**
 * `.computer-logs-viewer__list` — flex-1, overflow-auto, font-mono, text-xs, p-3, space-y-0.5.
 * NB: `space-y-0.5` is a between-children margin utility with no single-prop equivalent — the shipped
 * component must apply the vertical rhythm to its rows (see report).
 */
export const ComputerLogsViewerListFrame = styled(View, {
  name: 'ComputerLogsViewerList',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'auto',
  fontFamily: 'monospace',
  fontSize: '$xs',
  padding: '$3',
})

/** `.computer-logs-viewer__entry` — flex, gap-2. */
export const ComputerLogsViewerEntryFrame = styled(View, {
  name: 'ComputerLogsViewerEntry',
  display: 'flex',
  gap: '$2',
})

/** `.computer-logs-viewer__timestamp` — text-muted-foreground, shrink-0. */
export const ComputerLogsViewerTimestampFrame = styled(Text, {
  name: 'ComputerLogsViewerTimestamp',
  color: '$muted-foreground',
  flexShrink: 0,
})

/** `.computer-logs-viewer__source` — text-primary, shrink-0. */
export const ComputerLogsViewerSourceFrame = styled(Text, {
  name: 'ComputerLogsViewerSource',
  color: '$primary',
  flexShrink: 0,
})

/**
 * `.computer-logs-viewer__message` — break-all + the `--warn` (text-warning) / `--error`
 * (text-destructive) modifiers as a `level` variant.
 */
export const ComputerLogsViewerMessageFrame = styled(Text, {
  name: 'ComputerLogsViewerMessage',
  wordBreak: 'break-all',

  variants: {
    level: {
      warn: { color: '$warning' },
      error: { color: '$destructive' },
    },
  } as const,
})

/** `.computer-logs-viewer__empty` — text-sm, text-muted-foreground, py-4, text-center. */
export const ComputerLogsViewerEmptyFrame = styled(Text, {
  name: 'ComputerLogsViewerEmpty',
  fontSize: '$sm',
  color: '$muted-foreground',
  paddingVertical: '$4',
  textAlign: 'center',
})

export type LogLevel = 'warn' | 'error'

export interface StyledComputerLogsViewerProps extends React.ComponentProps<'div'> {}

const Frame = ComputerLogsViewerFrame as unknown as React.ComponentType<any>
export function StyledComputerLogsViewer({ ...props }: StyledComputerLogsViewerProps) {
  return <Frame {...props} />
}

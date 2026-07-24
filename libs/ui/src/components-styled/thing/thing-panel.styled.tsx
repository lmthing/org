/** thing-panel.styled.tsx — P2 conversion of the `.thing-panel` BEM family (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className panel. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.thing-panel` — flex shell over the background surface + `--full`/`--embedded` height modes. */
export const ThingPanelFrame = styled(View, {
  name: 'ThingPanel',
  display: 'flex',
  backgroundColor: '$background',

  variants: {
    mode: {
      full: { height: '100vh' },
      embedded: { height: '100%' },
    },
  } as const,
})

/** `.thing-panel__sidebar` — w-64 column rail with a right divider. */
export const ThingPanelSidebarFrame = styled(View, {
  name: 'ThingPanelSidebar',
  width: '$64',
  borderRightWidth: 1,
  borderRightColor: '$border',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
})

/** `.thing-panel__sidebar-header` — padded, space-between header row with a bottom divider. */
export const ThingPanelSidebarHeaderFrame = styled(View, {
  name: 'ThingPanelSidebarHeader',
  padding: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

/** `.thing-panel__sidebar-title` — inline gap-2 title cluster. */
export const ThingPanelSidebarTitleFrame = styled(View, {
  name: 'ThingPanelSidebarTitle',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.thing-panel__sidebar-brand` — inline gap-1.5 brand cluster. */
export const ThingPanelSidebarBrandFrame = styled(View, {
  name: 'ThingPanelSidebarBrand',
  display: 'flex',
  alignItems: 'center',
  gap: '$1.5',
})

/** `.thing-panel__sidebar-brand-name` — semibold text-sm brand label. */
export const ThingPanelSidebarBrandNameFrame = styled(Text, {
  name: 'ThingPanelSidebarBrandName',
  fontWeight: '$semibold',
  fontSize: '$sm',
})

/** `.thing-panel__sidebar-list` — flex-1 scrolling list body. */
export const ThingPanelSidebarListFrame = styled(View, {
  name: 'ThingPanelSidebarList',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  padding: '$2',
})

/** `.thing-panel__conv-btn` — full-width truncating conversation button + `--active` modifier
 *  (0.8125rem = 13px, no scale token). */
export const ThingPanelConvBtnFrame = styled(View, {
  name: 'ThingPanelConvBtn',
  display: 'block',
  width: '100%',
  textAlign: 'left',
  paddingVertical: '$2',
  paddingHorizontal: '$3',
  borderRadius: '$radius-md',
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: '$normal',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  marginBottom: '$0.5',

  variants: {
    active: {
      true: { backgroundColor: '$muted', fontWeight: '$semibold' },
    },
  } as const,
})

/** `.thing-panel__main` — flex-1 chat column. */
export const ThingPanelMainFrame = styled(View, {
  name: 'ThingPanelMain',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
})

/** `.thing-panel__chat-header` — space-between chat header row with a bottom divider. */
export const ThingPanelChatHeaderFrame = styled(View, {
  name: 'ThingPanelChatHeader',
  paddingVertical: '$3',
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

/** `.thing-panel__chat-title` — medium text-sm chat title. */
export const ThingPanelChatTitleFrame = styled(Text, {
  name: 'ThingPanelChatTitle',
  fontSize: '$sm',
  fontWeight: '$medium',
})

/** `.thing-panel__chat-status` — inline gap-2 status cluster. */
export const ThingPanelChatStatusFrame = styled(View, {
  name: 'ThingPanelChatStatus',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.thing-panel__chat-status-text` — dim text-xs status label. */
export const ThingPanelChatStatusTextFrame = styled(Text, {
  name: 'ThingPanelChatStatusText',
  fontSize: '$xs',
  opacity: 0.6,
})

/** `.thing-panel__status-dot` — 8px round status pip + tone modifiers
 *  (`--error`/`--working`/`--ready`/`--warn`). */
export const ThingPanelStatusDotFrame = styled(View, {
  name: 'ThingPanelStatusDot',
  width: 8,
  height: 8,
  borderRadius: '$radius-full',
  display: 'inline-block',

  variants: {
    tone: {
      error: { backgroundColor: '$destructive' },
      working: { backgroundColor: '$agent' },
      ready: { backgroundColor: '$knowledge' },
      warn: { backgroundColor: '$brand-2' },
    },
  } as const,
})

/** `.thing-panel__messages` — flex-1 scrolling column of message bubbles. */
export const ThingPanelMessagesFrame = styled(View, {
  name: 'ThingPanelMessages',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  padding: '$4',
  display: 'flex',
  flexDirection: 'column',
  gap: '$3',
})

/** `.thing-panel__env-warning` — muted rounded warning banner (0.8125rem = 13px). */
export const ThingPanelEnvWarningFrame = styled(View, {
  name: 'ThingPanelEnvWarning',
  paddingVertical: '$3',
  paddingHorizontal: '$4',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$muted',
  fontSize: 13,
})

/** `.thing-msg` — a bordered message bubble + `--user`/`--assistant` surfaces (0.75rem radius = xl). */
export const ThingMsgFrame = styled(View, {
  name: 'ThingMsg',
  maxWidth: '80%',
  paddingVertical: '$2.5',
  paddingHorizontal: '$3.5',
  borderRadius: '$radius-xl',
  fontSize: '$sm',
  lineHeight: '1.5' as unknown as number,
  borderWidth: 1,
  borderColor: '$border',

  variants: {
    role: {
      user: { alignSelf: 'flex-end', backgroundColor: '$primary', color: '$primary-foreground' },
      assistant: { alignSelf: 'flex-start', backgroundColor: '$card' },
    },
  } as const,
})

/** `.thing-msg__role` — uppercase wider-tracked role caption (0.6875rem = 11px). */
export const ThingMsgRoleFrame = styled(Text, {
  name: 'ThingMsgRole',
  fontSize: 11,
  fontWeight: '$semibold',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
  opacity: 0.6,
  marginBottom: '$1',
})

/** `.thing-msg__text` — pre-wrapped word-breaking body. */
export const ThingMsgTextFrame = styled(Text, {
  name: 'ThingMsgText',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
})

/** `.thing-msg__processing` — dim bordered processing bubble (0.8125rem = 13px). */
export const ThingMsgProcessingFrame = styled(View, {
  name: 'ThingMsgProcessing',
  alignSelf: 'flex-start',
  paddingVertical: '$2.5',
  paddingHorizontal: '$3.5',
  borderRadius: '$radius-xl',
  borderWidth: 1,
  borderColor: '$border',
  fontSize: 13,
  opacity: 0.7,
})

/** `.thing-tool-event` — dim monospace tool-call chip on the muted surface. */
export const ThingToolEventFrame = styled(View, {
  name: 'ThingToolEvent',
  marginVertical: '$2',
  padding: '$2',
  borderRadius: '$radius-md',
  fontSize: '$xs',
  fontFamily: 'monospace',
  backgroundColor: '$muted',
  borderWidth: 1,
  borderColor: '$border',
  opacity: 0.8,
})

/** `.thing-panel__input-form` — bottom-aligned input row with a top divider. */
export const ThingPanelInputFormFrame = styled(View, {
  name: 'ThingPanelInputForm',
  paddingVertical: '$3',
  paddingHorizontal: '$4',
  borderTopWidth: 1,
  borderTopColor: '$border',
  display: 'flex',
  gap: '$2',
  alignItems: 'flex-end',
})

/** `.thing-panel__textarea` — flex-1 non-resizing text-sm input. */
export const ThingPanelTextareaFrame = styled(View, {
  name: 'ThingPanelTextarea',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  resize: 'none',
  fontSize: '$sm',
})

export type ThingPanelMode = 'full' | 'embedded'

export interface StyledThingPanelProps extends React.ComponentProps<'div'> {
  mode?: ThingPanelMode
}

const Frame = ThingPanelFrame as unknown as React.ComponentType<any>

/** Idiomatic ThingPanel — same public API as the shipped className panel (`mode`). */
export function StyledThingPanel({ mode = 'full', ...props }: StyledThingPanelProps) {
  return <Frame mode={mode} {...props} />
}

/** thing-chat.styled.tsx — P2 conversion of the `.thing-chat` BEM family (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className chat. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.thing-chat` — full-height flex column over the background surface. */
export const ThingChatFrame = styled(View, {
  name: 'ThingChat',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minWidth: 0,
  backgroundColor: '$background',
})

/** `.thing-chat__header` — space-between header row with a bottom divider. */
export const ThingChatHeaderFrame = styled(View, {
  name: 'ThingChatHeader',
  paddingVertical: '$3',
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
})

/** `.thing-chat__header-title` — medium text-sm title. */
export const ThingChatHeaderTitleFrame = styled(Text, {
  name: 'ThingChatHeaderTitle',
  fontSize: '$sm',
  fontWeight: '$medium',
})

/** `.thing-chat__header-actions` — inline gap-3 action cluster. */
export const ThingChatHeaderActionsFrame = styled(View, {
  name: 'ThingChatHeaderActions',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
})

/** `.thing-chat__status` — inline gap-2 status cluster. */
export const ThingChatStatusFrame = styled(View, {
  name: 'ThingChatStatus',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.thing-chat__status-label` — dim text-xs status label. */
export const ThingChatStatusLabelFrame = styled(Text, {
  name: 'ThingChatStatusLabel',
  fontSize: '$xs',
  opacity: 0.6,
})

/** `.thing-chat__computer-btn` — pill status button on the muted surface with a hover blend.
 *  `font-family: inherit` / `color: inherit` are the element defaults and are left implicit.
 *  `transition: background 0.15s` awaits the animation driver (§5/P4). */
export const ThingChatComputerBtnFrame = styled(View, {
  name: 'ThingChatComputerBtn',
  display: 'flex',
  alignItems: 'center',
  gap: '$1.5',
  paddingVertical: '$1',
  paddingHorizontal: '$2.5',
  borderRadius: '$radius-full',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$muted',
  cursor: 'pointer',
  fontSize: '$xs',
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 80%, var(--foreground) 20%)' },
})

/** `.thing-chat__computer-label` — dimmed inner label. */
export const ThingChatComputerLabelFrame = styled(Text, {
  name: 'ThingChatComputerLabel',
  opacity: 0.7,
})

/** `.thing-chat__booting` — centered dim flex-1 boot placeholder. */
export const ThingChatBootingFrame = styled(View, {
  name: 'ThingChatBooting',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$2',
  opacity: 0.5,
})

/** `.thing-chat__booting-label` — text-sm boot caption. */
export const ThingChatBootingLabelFrame = styled(Text, {
  name: 'ThingChatBootingLabel',
  fontSize: '$sm',
})

/** `.thing-chat__messages` — flex-1 scrolling message column. */
export const ThingChatMessagesFrame = styled(View, {
  name: 'ThingChatMessages',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  padding: '$4',
  display: 'flex',
  flexDirection: 'column',
  gap: '$3',
})

/** `.thing-code-block` — bordered muted code container clipped to 90% width. */
export const ThingCodeBlockFrame = styled(View, {
  name: 'ThingCodeBlock',
  alignSelf: 'flex-start',
  maxWidth: '90%',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$muted',
  overflow: 'hidden',
})

/** `.thing-code-block__inner` — monospace pre-wrapped code body capped at 16rem. */
export const ThingCodeBlockInnerFrame = styled(Text, {
  name: 'ThingCodeBlockInner',
  paddingVertical: '$2',
  paddingHorizontal: '$3',
  fontFamily: 'monospace',
  fontSize: '$xs',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  lineHeight: '1.5' as unknown as number,
  maxHeight: '$64',
  overflowY: 'auto',
})

/** `.thing-code-block__cursor` — the streaming caret.
 *  `animation: thing-blink` (a `@keyframes` opacity blink) awaits the animation driver (§5/P4). */
export const ThingCodeBlockCursorFrame = styled(Text, {
  name: 'ThingCodeBlockCursor',
})

/** `.thing-error-block` — destructive-bordered error bubble (0.8125rem = 13px). */
export const ThingErrorBlockFrame = styled(View, {
  name: 'ThingErrorBlock',
  alignSelf: 'flex-start',
  maxWidth: '80%',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$destructive',
  paddingVertical: '$2',
  paddingHorizontal: '$3',
  fontSize: 13,
  color: '$destructive',
})

/** `.thing-hook-block` — dim monospace hook chip on the muted surface. */
export const ThingHookBlockFrame = styled(View, {
  name: 'ThingHookBlock',
  alignSelf: 'flex-start',
  paddingVertical: '$1',
  paddingHorizontal: '$2',
  borderRadius: '$radius',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$muted',
  fontSize: '$xs',
  fontFamily: 'monospace',
  opacity: 0.7,
})

/** `.thing-tasklist-block` — bordered tasklist card (0.8125rem = 13px). */
export const ThingTasklistBlockFrame = styled(View, {
  name: 'ThingTasklistBlock',
  alignSelf: 'flex-start',
  maxWidth: '80%',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  paddingVertical: '$2',
  paddingHorizontal: '$3',
  fontSize: 13,
})

/** `.thing-tasklist-block__title` — semibold tasklist heading. */
export const ThingTasklistBlockTitleFrame = styled(Text, {
  name: 'ThingTasklistBlockTitle',
  fontWeight: '$semibold',
  marginBottom: '$1.5',
})

/** `.thing-tasklist-block__task` — dim task row. */
export const ThingTasklistBlockTaskFrame = styled(View, {
  name: 'ThingTasklistBlockTask',
  paddingVertical: '$0.5',
  paddingHorizontal: 0,
  opacity: 0.8,
})

/** `.thing-task-complete` — dim bordered completion chip on the muted surface. */
export const ThingTaskCompleteFrame = styled(View, {
  name: 'ThingTaskComplete',
  alignSelf: 'flex-start',
  paddingVertical: '$1',
  paddingHorizontal: '$2',
  borderRadius: '$radius',
  fontSize: '$xs',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$muted',
  opacity: 0.7,
})

/** `.thing-chat__input-form` — bottom-aligned input row with a top divider. */
export const ThingChatInputFormFrame = styled(View, {
  name: 'ThingChatInputForm',
  paddingVertical: '$3',
  paddingHorizontal: '$4',
  borderTopWidth: 1,
  borderTopColor: '$border',
  display: 'flex',
  gap: '$2',
  alignItems: 'flex-end',
  flexShrink: 0,
})

/** `.thing-chat__textarea` — flex-1 bordered input with a ring focus + dim disabled state.
 *  `:focus` box-shadow ring approximated with an outline over the ring token at 20% alpha. */
export const ThingChatTextareaFrame = styled(View, {
  name: 'ThingChatTextarea',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  resize: 'none',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$background',
  paddingVertical: '$2',
  paddingHorizontal: '$3',
  fontSize: '$sm',
  lineHeight: '1.5' as unknown as number,
  outlineStyle: 'none',
  focusStyle: {
    borderColor: '$ring',
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: 'color-mix(in srgb, var(--ring) 20%, transparent)',
    outlineOffset: 0,
  },
  disabledStyle: { opacity: 0.4, cursor: 'not-allowed' },
})

/** `.thing-chat__send-btn` — primary send button with a dim disabled state. */
export const ThingChatSendBtnFrame = styled(View, {
  name: 'ThingChatSendBtn',
  borderRadius: '$radius-md',
  backgroundColor: '$primary',
  color: '$primary-foreground',
  paddingVertical: '$2',
  paddingHorizontal: '$4',
  fontSize: '$sm',
  fontWeight: '$medium',
  borderWidth: 0,
  cursor: 'pointer',
  flexShrink: 0,
  alignSelf: 'flex-end',
  disabledStyle: { opacity: 0.4, cursor: 'not-allowed' },
})

export interface StyledThingChatProps extends React.ComponentProps<'div'> {}

const Frame = ThingChatFrame as unknown as React.ComponentType<any>

/** Idiomatic ThingChat — same public API as the shipped className chat. */
export function StyledThingChat({ ...props }: StyledThingChatProps) {
  return <Frame {...props} />
}

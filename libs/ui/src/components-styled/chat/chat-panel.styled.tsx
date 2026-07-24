/** chat-panel.styled.tsx — P2 conversion of the `.chat-panel` / `.chat-bubble` / `.chat-loading` /
 *  `.chat-input` BEM blocks (docs/tamagui-idiomatic-migration.md §4). One styled() per BEM selector;
 *  modifiers → variants. Lands alongside the shipped className chat-panel components.
 *  Frame names are globally-unique `ChatPanel*`. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.chat-panel` — flex! flex-col overflow-hidden; height:100%. */
export const ChatPanelFrame = styled(View, {
  name: 'ChatPanel',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  height: '100%',
})

/** `.chat-panel__header` — flex! justify-end. */
export const ChatPanelHeaderFrame = styled(View, {
  name: 'ChatPanelHeader',
  display: 'flex',
  justifyContent: 'flex-end',
})

/** `.chat-panel__messages` — flex-1 overflow-y-auto; padding:1rem 1.5rem. */
export const ChatPanelMessagesFrame = styled(View, {
  name: 'ChatPanelMessages',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  paddingVertical: '$4', // 1rem
  paddingHorizontal: '$6', // 1.5rem
})

/** `.chat-panel__empty` — flex! flex-col items-center justify-center text-center; height:100%. */
export const ChatPanelEmptyFrame = styled(View, {
  name: 'ChatPanelEmpty',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  height: '100%',
})

/** `.chat-panel__empty-icon` — font-size:2rem; margin-bottom:1rem. */
export const ChatPanelEmptyIconFrame = styled(Text, {
  name: 'ChatPanelEmptyIcon',
  fontSize: 32, // 2rem, no token
  marginBottom: '$4', // 1rem
})

/** `.chat-bubble` — flex! + `--user`/`--assistant` justify modifiers → `role` variant. */
export const ChatPanelBubbleFrame = styled(View, {
  name: 'ChatPanelBubble',
  display: 'flex',
  variants: {
    role: {
      user: { justifyContent: 'flex-end' },
      assistant: { justifyContent: 'flex-start' },
    },
  } as const,
})

/** `.chat-bubble__content` — max-width:85%; border-radius:1rem; padding:0.75rem 1rem +
 *  `--user` surface modifier → `user` boolean variant. */
export const ChatPanelBubbleContentFrame = styled(View, {
  name: 'ChatPanelBubbleContent',
  maxWidth: '85%',
  borderRadius: 16, // 1rem, no token
  paddingVertical: '$3', // 0.75rem
  paddingHorizontal: '$4', // 1rem
  variants: {
    user: {
      true: { backgroundColor: '$agent', color: '$agent-foreground' },
    },
  } as const,
})

/** `.chat-bubble__text` — font-size:0.875rem; line-height:1.6; pre-wrap; break-word. */
export const ChatPanelBubbleTextFrame = styled(Text, {
  name: 'ChatPanelBubbleText',
  fontSize: '$sm',
  lineHeight: '1.6' as unknown as number,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
})

/** `.chat-bubble__cursor` — inline-block; width:4px; height:1rem; bg agent; margin-left:4px. */
export const ChatPanelBubbleCursorFrame = styled(View, {
  name: 'ChatPanelBubbleCursor',
  display: 'inline-block',
  width: 4,
  height: '$4', // 1rem
  backgroundColor: '$agent',
  marginLeft: 4,
  // animation: pulse awaits the animation driver (§5/P4)
})

/** `.chat-bubble__structured-output` — margin-top:0.75rem. */
export const ChatPanelBubbleStructuredOutputFrame = styled(View, {
  name: 'ChatPanelBubbleStructuredOutput',
  marginTop: '$3',
})

/** `.chat-bubble__timestamp` — margin-top:0.25rem; display:block; opacity:0.6; font-size:0.625rem. */
export const ChatPanelBubbleTimestampFrame = styled(Text, {
  name: 'ChatPanelBubbleTimestamp',
  marginTop: '$1',
  display: 'block',
  opacity: 0.6,
  fontSize: 10, // 0.625rem, no token
})

/** `.chat-bubble__slash-action` — margin-bottom:0.5rem. */
export const ChatPanelBubbleSlashActionFrame = styled(View, {
  name: 'ChatPanelBubbleSlashAction',
  marginBottom: '$2',
})

/** `.chat-bubble__slash-tag` — inline-block; padding:0.25rem 0.5rem; rounded; brand-2 15% tint. */
export const ChatPanelBubbleSlashTagFrame = styled(Text, {
  name: 'ChatPanelBubbleSlashTag',
  display: 'inline-block',
  paddingVertical: '$1', // 0.25rem
  paddingHorizontal: '$2', // 0.5rem
  borderRadius: '$radius-sm', // 0.25rem
  backgroundColor: 'color-mix(in srgb, var(--brand-2) 15%, transparent)',
  color: '$brand-2',
  fontFamily: 'monospace',
  fontSize: '$xs', // 0.75rem
  fontWeight: '$semibold',
})

/** `.chat-bubble__slash-params` — font-weight:400; margin-left:0.5rem; opacity:0.8. */
export const ChatPanelBubbleSlashParamsFrame = styled(Text, {
  name: 'ChatPanelBubbleSlashParams',
  fontWeight: '$normal',
  marginLeft: '$2',
  opacity: 0.8,
})

/** `.chat-loading-dots` — flex!; gap:0.25rem. */
export const ChatPanelLoadingDotsFrame = styled(View, {
  name: 'ChatPanelLoadingDots',
  display: 'flex',
  gap: '$1',
})

/** `.chat-loading-dot` — 0.5rem circle, muted-foreground. `:nth-child(2|3)` only set
 *  animation-delay — animation awaits the animation driver (§5/P4). */
export const ChatPanelLoadingDotFrame = styled(View, {
  name: 'ChatPanelLoadingDot',
  width: '$2', // 0.5rem
  height: '$2',
  borderRadius: '$radius-full', // 9999px
  backgroundColor: '$muted-foreground',
  // animation: bounce (+ nth-child delay) awaits the animation driver (§5/P4)
})

/** `.chat-input__wrapper` — flex:1; position:relative. */
export const ChatPanelInputWrapperFrame = styled(View, {
  name: 'ChatPanelInputWrapper',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  position: 'relative',
})

/** `.chat-input__autocomplete` — absolute above the input; max-height:15rem; scrolls. */
export const ChatPanelInputAutocompleteFrame = styled(View, {
  name: 'ChatPanelInputAutocomplete',
  position: 'absolute',
  bottom: '100%',
  left: 0,
  right: 0,
  marginBottom: '$2',
  maxHeight: '$60', // 15rem
  overflowY: 'auto',
})

/** `.chat-input__autocomplete-item` — width:100%; text-align:left. */
export const ChatPanelInputAutocompleteItemFrame = styled(View, {
  name: 'ChatPanelInputAutocompleteItem',
  width: '100%',
  textAlign: 'left',
})

/** `.chat-input__hint` — margin-top:0.5rem. */
export const ChatPanelInputHintFrame = styled(View, {
  name: 'ChatPanelInputHint',
  marginTop: '$2',
})

export interface StyledChatPanelProps extends React.ComponentProps<'div'> {}

const Frame = ChatPanelFrame as unknown as React.ComponentType<any>

/** Idiomatic ChatPanel shell — renders the `.chat-panel` base frame. */
export function StyledChatPanel({ ...props }: StyledChatPanelProps) {
  return <Frame {...props} />
}

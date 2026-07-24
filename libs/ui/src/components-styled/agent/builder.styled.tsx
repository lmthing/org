/** builder.styled.tsx — P2 conversion of libs/css/src/components/agent/builder/index.css
 *  (docs/tamagui-idiomatic-migration.md §4). One exported styled() *Frame per BEM selector across the
 *  ~19 blocks this file ships (actions-panel, agent-builder, agent-header, attach-workflow-modal,
 *  chat-fab, configuration-form, create-agent-inline, field-selector, knowledge-pill-bar/pill,
 *  prompt-preview, save-agent-modal, saved-agents-list, slash-action-card, slash-actions-panel,
 *  thing-panel, tools-panel, area-knowledge, agent-form). `--modifier` → variants, `:hover`/`:disabled`
 *  → pseudo styles. Every `name:` is globally prefixed `AgentBuilder` so it never collides with the
 *  agent/runtime proofs. Lands alongside the shipped className components; builder-styled.test.tsx pins
 *  the load-bearing frames.
 *
 *  `transition-*`/`transition:` on switches, pills, cards and the fab await the animation driver (§5/P4)
 *  and are OMITTED. `font-mono` (no font-family token) and `resize-y` are web-only and OMITTED with a
 *  note. See the tail of this file for the handful of lines that could not be faithfully expressed.
 */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/* ==========================================================================
   ACTIONS PANEL
   ========================================================================== */

export const AgentBuilderActionsPanel = styled(View, {
  name: 'AgentBuilderActionsPanel',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
})

export const AgentBuilderActionsPanelHeaderRow = styled(View, {
  name: 'AgentBuilderActionsPanelHeaderRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

export const AgentBuilderActionsPanelBody = styled(View, {
  name: 'AgentBuilderActionsPanelBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  padding: '$4',
})

export const AgentBuilderActionsPanelEmpty = styled(View, {
  name: 'AgentBuilderActionsPanelEmpty',
  textAlign: 'center',
  paddingVertical: '$12', // padding: 3rem 0
})

export const AgentBuilderActionsPanelEmptyIcon = styled(Text, {
  name: 'AgentBuilderActionsPanelEmptyIcon',
  fontSize: 32, // text-[2rem]
  marginBottom: '$2',
})

export const AgentBuilderActionsPanelEmptyCaption = styled(Text, {
  name: 'AgentBuilderActionsPanelEmptyCaption',
  marginHorizontal: 'auto',
  marginBottom: '$4',
  maxWidth: 200,
})

export const AgentBuilderActionsPanelFooterCaption = styled(Text, {
  name: 'AgentBuilderActionsPanelFooterCaption',
  textAlign: 'center',
  display: 'block',
})

export const AgentBuilderActionsPanelCardRow = styled(View, {
  name: 'AgentBuilderActionsPanelCardRow',
  display: 'flex',
  alignItems: 'flex-start',
})

export const AgentBuilderActionsPanelCardIcon = styled(View, {
  name: 'AgentBuilderActionsPanelCardIcon',
  flexShrink: 0,
  fontSize: 20, // 1.25rem
})

export const AgentBuilderActionsPanelCardContent = styled(View, {
  name: 'AgentBuilderActionsPanelCardContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

export const AgentBuilderActionsPanelCardTitleRow = styled(View, {
  name: 'AgentBuilderActionsPanelCardTitleRow',
  display: 'flex',
  alignItems: 'center',
  marginBottom: '$1',
})

export const AgentBuilderActionsPanelCardLabel = styled(Text, {
  name: 'AgentBuilderActionsPanelCardLabel',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

export const AgentBuilderActionsPanelCardDescription = styled(Text, {
  name: 'AgentBuilderActionsPanelCardDescription',
  marginTop: '$0.5', // 0.125rem
})

export const AgentBuilderActionsPanelCardMetaRow = styled(View, {
  name: 'AgentBuilderActionsPanelCardMetaRow',
  marginTop: '$2',
})

export const AgentBuilderActionsPanelBadgeSm = styled(Text, {
  name: 'AgentBuilderActionsPanelBadgeSm',
  fontSize: 10, // 0.625rem
})

/* ==========================================================================
   ASSISTANT BUILDER (the .agent-builder shell)
   ========================================================================== */

export const AgentBuilder = styled(View, {
  name: 'AgentBuilder',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
})

export const AgentBuilderContent = styled(View, {
  name: 'AgentBuilderContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  overflow: 'hidden',
})

export const AgentBuilderMain = styled(View, {
  name: 'AgentBuilderMain',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
})

export const AgentBuilderMainInner = styled(View, {
  name: 'AgentBuilderMainInner',
  marginHorizontal: 'auto',
  maxWidth: 768, // 48rem
  paddingVertical: '$8', // padding: 2rem 1.5rem
  paddingHorizontal: '$6',
})

export const AgentBuilderTextarea = styled(View, {
  name: 'AgentBuilderTextarea',
  // font-mono: no font-family token — applied by component. resize-y: web-only vertical resize.
  minHeight: 240,
})

export const AgentBuilderAside = styled(View, {
  name: 'AgentBuilderAside',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  width: '$80', // 20rem
  borderLeftWidth: 1,
  borderLeftColor: '$border',
})

export const AgentBuilderAsideBody = styled(View, {
  name: 'AgentBuilderAsideBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'hidden',
})

/* ==========================================================================
   ASSISTANT HEADER
   ========================================================================== */

export const AgentBuilderHeader = styled(View, {
  name: 'AgentBuilderHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
  paddingVertical: '$3', // 0.75rem 1rem
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

export const AgentBuilderHeaderLeft = styled(View, {
  name: 'AgentBuilderHeaderLeft',
  display: 'flex',
  alignItems: 'center',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
  gap: '$3',
})

export const AgentBuilderHeaderIcon = styled(View, {
  name: 'AgentBuilderHeaderIcon',
  width: '$4',
  height: '$4',
})

export const AgentBuilderHeaderNameWrap = styled(View, {
  name: 'AgentBuilderHeaderNameWrap',
  minWidth: 0,
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

export const AgentBuilderHeaderNameInput = styled(View, {
  name: 'AgentBuilderHeaderNameInput',
  borderWidth: 0, // border-none
  backgroundColor: 'transparent',
  // shadow-none
  fontWeight: '$semibold', // 600
  fontSize: 18, // 1.125rem
  paddingLeft: 0,
  height: 'auto',
})

export const AgentBuilderHeaderDescInput = styled(View, {
  name: 'AgentBuilderHeaderDescInput',
  borderWidth: 0,
  backgroundColor: 'transparent',
  fontSize: 13, // 0.8125rem
  paddingLeft: 0,
  height: 'auto',
  color: '$muted-foreground',
})

export const AgentBuilderHeaderRight = styled(View, {
  name: 'AgentBuilderHeaderRight',
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
})

export const AgentBuilderHeaderBtnIcon = styled(View, {
  name: 'AgentBuilderHeaderBtnIcon',
  width: '$4',
  height: '$4',
  marginRight: '$1.5', // 0.375rem
})

/* ==========================================================================
   ATTACH WORKFLOW MODAL
   ========================================================================== */

export const AgentBuilderAttachModalBody = styled(View, {
  name: 'AgentBuilderAttachModalBody',
  marginTop: '$4',
})

export const AgentBuilderAttachModalSearchWrap = styled(View, {
  name: 'AgentBuilderAttachModalSearchWrap',
  position: 'relative',
  marginBottom: '$3',
})

export const AgentBuilderAttachModalSearchIcon = styled(View, {
  name: 'AgentBuilderAttachModalSearchIcon',
  position: 'absolute',
  pointerEvents: 'none',
  left: '$2.5', // 0.625rem
  top: '50%',
  transform: 'translateY(-50%)',
  width: 14, // 0.875rem
  height: 14,
  color: '$muted-foreground',
})

export const AgentBuilderAttachModalSearchInput = styled(View, {
  name: 'AgentBuilderAttachModalSearchInput',
  paddingLeft: '$8', // 2rem
})

export const AgentBuilderAttachModalList = styled(View, {
  name: 'AgentBuilderAttachModalList',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  maxHeight: 320, // 20rem
  gap: '$1.5',
})

export const AgentBuilderAttachModalEmpty = styled(View, {
  name: 'AgentBuilderAttachModalEmpty',
  textAlign: 'center',
  padding: '$8', // 2rem
})

export const AgentBuilderAttachModalCardRow = styled(View, {
  name: 'AgentBuilderAttachModalCardRow',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

export const AgentBuilderAttachModalCardLeft = styled(View, {
  name: 'AgentBuilderAttachModalCardLeft',
  display: 'flex',
  alignItems: 'center',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

export const AgentBuilderAttachModalCardIcon = styled(View, {
  name: 'AgentBuilderAttachModalCardIcon',
  flexShrink: 0,
  width: '$4',
  height: '$4',
  color: '$agent',
})

export const AgentBuilderAttachModalCardNameWrap = styled(View, {
  name: 'AgentBuilderAttachModalCardNameWrap',
  minWidth: 0,
})

export const AgentBuilderAttachModalCardName = styled(Text, {
  name: 'AgentBuilderAttachModalCardName',
  display: 'block',
})

export const AgentBuilderAttachModalFooter = styled(View, {
  name: 'AgentBuilderAttachModalFooter',
  display: 'flex',
  justifyContent: 'flex-end',
  marginTop: '$4',
})

/* ==========================================================================
   CHAT FAB
   ========================================================================== */

export const AgentBuilderChatFab = styled(View, {
  name: 'AgentBuilderChatFab',
  position: 'fixed',
  display: 'inline-flex',
  alignItems: 'center',
  borderWidth: 0, // border-none
  cursor: 'pointer',
  zIndex: 50,
  bottom: '$6', // 1.5rem
  right: '$6',
  height: '$12', // 3rem
  paddingLeft: '$4', // 1rem
  paddingRight: '$5', // 1.25rem
  borderRadius: '$radius-full',
  backgroundColor: '$agent',
  color: '$agent-foreground',
  gap: '$2',
  fontSize: 15, // 0.9375rem
  fontWeight: '$semibold', // 600
  // box-shadow: 0 4px 12px color-mix(... var(--agent) 35% ...)
  shadowColor: 'color-mix(in srgb, var(--agent) 35%, transparent)',
  shadowOffset: { width: 0, height: 4 },
  shadowRadius: 12,
  // transition: transform / box-shadow awaits the animation driver (§5/P4)
  hoverStyle: {
    transform: 'scale(1.05)',
    shadowColor: 'color-mix(in srgb, var(--agent) 45%, transparent)',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 20,
  },
})

export const AgentBuilderChatFabIcon = styled(View, {
  name: 'AgentBuilderChatFabIcon',
  width: '$5', // 1.25rem
  height: '$5',
})

/* ==========================================================================
   CONFIGURATION FORM
   ========================================================================== */

export const AgentBuilderConfigToggleSwitch = styled(View, {
  name: 'AgentBuilderConfigToggleSwitch',
  position: 'relative',
  borderWidth: 0,
  cursor: 'pointer',
  width: '$11', // 2.75rem
  height: '$6', // 1.5rem
  borderRadius: '$radius-full', // 9999px
  // transition: background-color awaits the animation driver (§5/P4)
  variants: {
    on: {
      true: { backgroundColor: '$primary' },
      false: { backgroundColor: '$muted' },
    },
  } as const,
})

export const AgentBuilderConfigToggleKnob = styled(View, {
  name: 'AgentBuilderConfigToggleKnob',
  position: 'absolute',
  top: '$0.5', // 0.125rem
  left: '$0.5',
  width: '$5', // 1.25rem
  height: '$5',
  borderRadius: '$radius-full', // 9999px
  backgroundColor: 'white',
  // transition: transform awaits the animation driver (§5/P4)
  variants: {
    on: {
      true: { transform: 'translateX(20px)' }, // translateX(1.25rem)
      false: { transform: 'translateX(0)' },
    },
  } as const,
})

export const AgentBuilderConfigMultiselectPills = styled(View, {
  name: 'AgentBuilderConfigMultiselectPills',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$2',
})

export const AgentBuilderConfigPillBtn = styled(View, {
  name: 'AgentBuilderConfigPillBtn',
  cursor: 'pointer',
  borderWidth: 0,
})

export const AgentBuilderConfigFieldHeader = styled(View, {
  name: 'AgentBuilderConfigFieldHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '$1',
})

export const AgentBuilderConfigFieldLabelRow = styled(View, {
  name: 'AgentBuilderConfigFieldLabelRow',
  display: 'flex',
  alignItems: 'center',
})

export const AgentBuilderConfigRequiredMark = styled(Text, {
  name: 'AgentBuilderConfigRequiredMark',
  fontSize: 12, // 0.75rem
  color: '$destructive',
})

export const AgentBuilderConfigRuntimeBadge = styled(View, {
  name: 'AgentBuilderConfigRuntimeBadge',
  cursor: 'pointer',
  borderWidth: 0,
  fontSize: 10, // 0.625rem
})

export const AgentBuilderConfigFieldDescription = styled(Text, {
  name: 'AgentBuilderConfigFieldDescription',
  marginBottom: '$2',
})

export const AgentBuilderConfigRuntimeBox = styled(View, {
  name: 'AgentBuilderConfigRuntimeBox',
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: '$brand-2',
  borderRadius: '$radius-md',
  padding: '$3',
  backgroundColor: 'color-mix(in srgb, var(--brand-2) 5%, transparent)',
})

export const AgentBuilderConfigRuntimeInner = styled(View, {
  name: 'AgentBuilderConfigRuntimeInner',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

export const AgentBuilderConfigRuntimeHint = styled(Text, {
  name: 'AgentBuilderConfigRuntimeHint',
  fontStyle: 'italic',
})

export const AgentBuilderConfigSectionHeader = styled(View, {
  name: 'AgentBuilderConfigSectionHeader',
  marginBottom: '$1',
})

export const AgentBuilderConfigSchemaHeader = styled(View, {
  name: 'AgentBuilderConfigSchemaHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

export const AgentBuilderConfigSchemaLabelRow = styled(View, {
  name: 'AgentBuilderConfigSchemaLabelRow',
  display: 'flex',
  alignItems: 'center',
})

export const AgentBuilderConfigBulkRuntimeBadge = styled(View, {
  name: 'AgentBuilderConfigBulkRuntimeBadge',
  cursor: 'pointer',
  borderWidth: 0,
  fontSize: 10, // 0.625rem
})

export const AgentBuilderConfigSectionLabel = styled(Text, {
  name: 'AgentBuilderConfigSectionLabel',
  fontWeight: '$semibold',
  marginBottom: '$2',
})

export const AgentBuilderConfigCategoryLabel = styled(Text, {
  name: 'AgentBuilderConfigCategoryLabel',
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontSize: 11, // 0.6875rem
  marginBottom: '$3',
  opacity: 0.7,
})

/* ==========================================================================
   CREATE ASSISTANT INLINE
   ========================================================================== */

export const AgentBuilderCreateInline = styled(View, {
  name: 'AgentBuilderCreateInline',
  marginBottom: '$6',
})

export const AgentBuilderCreateInlineHeaderRow = styled(View, {
  name: 'AgentBuilderCreateInlineHeaderRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
})

export const AgentBuilderCreateInlineHeaderLeft = styled(View, {
  name: 'AgentBuilderCreateInlineHeaderLeft',
  display: 'flex',
  alignItems: 'center',
})

export const AgentBuilderCreateInlineAvatar = styled(View, {
  name: 'AgentBuilderCreateInlineAvatar',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$2',
  backgroundColor: '$agent', // background: var(--agent)
  borderRadius: 8, // 0.5rem
})

export const AgentBuilderCreateInlineAvatarIcon = styled(View, {
  name: 'AgentBuilderCreateInlineAvatarIcon',
  width: '$5',
  height: '$5',
  color: 'white',
})

export const AgentBuilderCreateInlineCloseIcon = styled(View, {
  name: 'AgentBuilderCreateInlineCloseIcon',
  width: '$4',
  height: '$4',
})

export const AgentBuilderCreateInlineActions = styled(View, {
  name: 'AgentBuilderCreateInlineActions',
  paddingTop: '$1',
})

export const AgentBuilderCreateInlineBtn = styled(View, {
  name: 'AgentBuilderCreateInlineBtn',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/* ==========================================================================
   FIELD SELECTOR
   ========================================================================== */

export const AgentBuilderFieldSelectorCard = styled(View, {
  name: 'AgentBuilderFieldSelectorCard',
  cursor: 'pointer',
})

export const AgentBuilderFieldSelectorCardRow = styled(View, {
  name: 'AgentBuilderFieldSelectorCardRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

export const AgentBuilderFieldSelectorCardContent = styled(View, {
  name: 'AgentBuilderFieldSelectorCardContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

export const AgentBuilderFieldSelectorCardDescription = styled(Text, {
  name: 'AgentBuilderFieldSelectorCardDescription',
  marginTop: '$0.5',
})

export const AgentBuilderFieldSelectorCardCount = styled(Text, {
  name: 'AgentBuilderFieldSelectorCardCount',
  marginTop: '$0.5',
})

/* ==========================================================================
   KNOWLEDGE PILL BAR
   ========================================================================== */

export const AgentBuilderKnowledgePillBar = styled(View, {
  name: 'AgentBuilderKnowledgePillBar',
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  paddingVertical: '$2.5', // 0.625rem 1rem
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  gap: '$3',
})

export const AgentBuilderKnowledgePillBarLabel = styled(Text, {
  name: 'AgentBuilderKnowledgePillBarLabel',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  fontSize: 11, // 0.6875rem
  fontWeight: '$semibold', // 600
  letterSpacing: '0.05em',
  color: '$muted-foreground',
})

export const AgentBuilderKnowledgePillBarScroll = styled(View, {
  name: 'AgentBuilderKnowledgePillBarScroll',
  display: 'flex',
  alignItems: 'center',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowX: 'auto',
  gap: '$1.5',
  // scrollbar-width: none + ::-webkit-scrollbar{display:none} — see the not-converted note at file tail
})

export const AgentBuilderKnowledgePillBarClear = styled(View, {
  name: 'AgentBuilderKnowledgePillBarClear',
  backgroundColor: 'transparent',
  borderWidth: 0,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  fontSize: 12, // 0.75rem
  color: '$muted-foreground',
  hoverStyle: { color: '$foreground' },
})

export const AgentBuilderKnowledgePill = styled(View, {
  name: 'AgentBuilderKnowledgePill',
  display: 'inline-flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  cursor: 'pointer',
  gap: '$1.5',
  paddingVertical: '$1.5', // 0.375rem 0.75rem
  paddingHorizontal: '$3',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: 'transparent',
  color: '$foreground',
  fontSize: 13, // 0.8125rem
  fontWeight: '$medium', // 500
  // transition: all awaits the animation driver (§5/P4)
  hoverStyle: { borderColor: '$agent', color: '$agent' },
  variants: {
    selected: {
      true: {
        borderColor: '$agent',
        backgroundColor: '$agent',
        color: '$agent-foreground',
        hoverStyle: { borderColor: '$agent', color: '$agent-foreground' },
      },
    },
  } as const,
})

export const AgentBuilderKnowledgePillIcon = styled(View, {
  name: 'AgentBuilderKnowledgePillIcon',
  width: 14, // 0.875rem
  height: 14,
})

export const AgentBuilderKnowledgePillFolderIcon = styled(View, {
  name: 'AgentBuilderKnowledgePillFolderIcon',
  width: 14,
  height: 14,
  color: '$knowledge',
})

/* ==========================================================================
   PROMPT PREVIEW
   ========================================================================== */

export const AgentBuilderPromptPreview = styled(View, {
  name: 'AgentBuilderPromptPreview',
  overflow: 'hidden',
})

export const AgentBuilderPromptPreviewHeader = styled(View, {
  name: 'AgentBuilderPromptPreviewHeader',
  cursor: 'pointer',
  userSelect: 'none',
})

export const AgentBuilderPromptPreviewHeaderRow = styled(View, {
  name: 'AgentBuilderPromptPreviewHeaderRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

export const AgentBuilderPromptPreviewHeaderLeft = styled(View, {
  name: 'AgentBuilderPromptPreviewHeaderLeft',
  display: 'flex',
  alignItems: 'center',
})

export const AgentBuilderPromptPreviewChevron = styled(Text, {
  name: 'AgentBuilderPromptPreviewChevron',
  fontSize: 12, // 0.75rem
  color: '$muted-foreground',
  // transition: transform awaits the animation driver (§5/P4)
  variants: {
    expanded: {
      true: { transform: 'rotate(180deg)' },
    },
  } as const,
})

export const AgentBuilderPromptPreviewEmpty = styled(View, {
  name: 'AgentBuilderPromptPreviewEmpty',
  textAlign: 'center',
  paddingVertical: '$8', // 2rem 0
})

export const AgentBuilderPromptPreviewBadges = styled(View, {
  name: 'AgentBuilderPromptPreviewBadges',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$1.5',
  marginBottom: '$3',
})

export const AgentBuilderPromptPreviewBadge = styled(Text, {
  name: 'AgentBuilderPromptPreviewBadge',
  fontSize: 10, // 0.625rem
})

export const AgentBuilderPromptPreviewCode = styled(Text, {
  name: 'AgentBuilderPromptPreviewCode',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  overflowY: 'auto',
  maxHeight: 400,
})

export const AgentBuilderPromptPreviewFooterRow = styled(View, {
  name: 'AgentBuilderPromptPreviewFooterRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/* ==========================================================================
   SAVE ASSISTANT MODAL
   ========================================================================== */

export const AgentBuilderSaveModalContent = styled(View, {
  name: 'AgentBuilderSaveModalContent',
  maxWidth: 448, // 28rem
})

export const AgentBuilderSaveModalHeaderRow = styled(View, {
  name: 'AgentBuilderSaveModalHeaderRow',
  display: 'flex',
  alignItems: 'center',
})

export const AgentBuilderSaveModalIconWrap = styled(View, {
  name: 'AgentBuilderSaveModalIconWrap',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '$10', // 2.5rem
  height: '$10',
  borderRadius: 12, // 0.75rem
  backgroundColor: '$agent', // original is a linear-gradient — see not-converted note at file tail
})

export const AgentBuilderSaveModalIcon = styled(View, {
  name: 'AgentBuilderSaveModalIcon',
  width: '$5',
  height: '$5',
  color: 'white',
})

export const AgentBuilderSaveModalForm = styled(View, {
  name: 'AgentBuilderSaveModalForm',
  padding: '$6',
})

export const AgentBuilderSaveModalFooter = styled(View, {
  name: 'AgentBuilderSaveModalFooter',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$3',
})

/* ==========================================================================
   SAVED ASSISTANTS LIST
   ========================================================================== */

export const AgentBuilderSavedList = styled(View, {
  name: 'AgentBuilderSavedList',
  marginHorizontal: 'auto',
  maxWidth: 1024, // 64rem
  padding: '$6',
})

export const AgentBuilderSavedListHeader = styled(View, {
  name: 'AgentBuilderSavedListHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '$8',
})

export const AgentBuilderSavedListSubtitle = styled(Text, {
  name: 'AgentBuilderSavedListSubtitle',
  marginTop: '$1',
})

export const AgentBuilderSavedListEmpty = styled(View, {
  name: 'AgentBuilderSavedListEmpty',
  textAlign: 'center',
  paddingVertical: '$16', // 4rem 0
})

export const AgentBuilderSavedListEmptyIcon = styled(Text, {
  name: 'AgentBuilderSavedListEmptyIcon',
  marginBottom: '$4',
  fontSize: 40, // 2.5rem
})

export const AgentBuilderSavedListEmptyCaption = styled(Text, {
  name: 'AgentBuilderSavedListEmptyCaption',
  marginHorizontal: 'auto',
  maxWidth: 448, // 28rem
  marginTop: '$2',
})

export const AgentBuilderSavedListGrid = styled(View, {
  name: 'AgentBuilderSavedListGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: '$4',
})

export const AgentBuilderSavedListCardHeader = styled(View, {
  name: 'AgentBuilderSavedListCardHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: '$3',
})

export const AgentBuilderSavedListCardContent = styled(View, {
  name: 'AgentBuilderSavedListCardContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

export const AgentBuilderSavedListCardName = styled(Text, {
  name: 'AgentBuilderSavedListCardName',
  fontWeight: '$semibold',
})

export const AgentBuilderSavedListCardDescription = styled(Text, {
  name: 'AgentBuilderSavedListCardDescription',
  overflow: 'hidden',
  marginTop: '$1',
  // -webkit-line-clamp: 2 / -webkit-box — 2-line clamp, see the not-converted note at file tail
})

export const AgentBuilderSavedListCardBadges = styled(View, {
  name: 'AgentBuilderSavedListCardBadges',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$1.5',
  marginBottom: '$4',
})

export const AgentBuilderSavedListBadgeSm = styled(Text, {
  name: 'AgentBuilderSavedListBadgeSm',
  fontSize: 10, // 0.625rem
})

export const AgentBuilderSavedListCardFooter = styled(View, {
  name: 'AgentBuilderSavedListCardFooter',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/* ==========================================================================
   SLASH ACTION CARD
   ========================================================================== */

export const AgentBuilderSlashActionCard = styled(View, {
  name: 'AgentBuilderSlashActionCard',
  padding: '$3',
  borderRadius: '$radius-xl', // rounded-xl
  borderWidth: 2, // border-2
  backgroundColor: '$muted',
  // transition-all awaits the animation driver (§5/P4)
  variants: {
    enabled: {
      true: {
        borderColor: 'color-mix(in srgb, var(--brand-3) 30%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
      },
    },
    disabled: {
      true: {
        borderColor: '$border',
        opacity: 0.6,
      },
    },
  } as const,
})

export const AgentBuilderSlashActionCardRow = styled(View, {
  name: 'AgentBuilderSlashActionCardRow',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '$3',
})

export const AgentBuilderSlashActionCardContent = styled(View, {
  name: 'AgentBuilderSlashActionCardContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

export const AgentBuilderSlashActionCardTriggerRow = styled(View, {
  name: 'AgentBuilderSlashActionCardTriggerRow',
  display: 'flex',
  alignItems: 'center',
  marginBottom: '$2',
})

export const AgentBuilderSlashActionCardMeta = styled(View, {
  name: 'AgentBuilderSlashActionCardMeta',
  marginTop: '$2',
})

export const AgentBuilderSlashActionCardActions = styled(View, {
  name: 'AgentBuilderSlashActionCardActions',
  display: 'flex',
  alignItems: 'center',
})

export const AgentBuilderSlashActionCardToggle = styled(View, {
  name: 'AgentBuilderSlashActionCardToggle',
  position: 'relative',
  borderRadius: '$radius-full',
  borderWidth: 0,
  cursor: 'pointer',
  width: '$10', // 2.5rem
  height: '$5', // 1.25rem
  // transition: background-color awaits the animation driver (§5/P4)
  variants: {
    on: {
      true: { backgroundColor: '$brand-3' },
      false: { backgroundColor: '$neutral' },
    },
  } as const,
})

export const AgentBuilderSlashActionCardToggleKnob = styled(View, {
  name: 'AgentBuilderSlashActionCardToggleKnob',
  position: 'absolute',
  borderRadius: '$radius-full',
  // shadow (tailwind default) ≈ opaque-black-with-alpha, single-layer
  shadowColor: 'rgba(0,0,0,0.1)',
  shadowOffset: { width: 0, height: 1 },
  shadowRadius: 3,
  top: '$0.5', // 0.125rem
  width: '$4', // 1rem
  height: '$4',
  backgroundColor: '$background',
  // transition: transform awaits the animation driver (§5/P4)
  variants: {
    on: {
      true: { left: '$5' }, // 1.25rem
      false: { left: '$0.5' }, // 0.125rem
    },
  } as const,
})

export const AgentBuilderSlashActionCardBtnIcon = styled(View, {
  name: 'AgentBuilderSlashActionCardBtnIcon',
  width: '$4',
  height: '$4',
})

/* ==========================================================================
   SLASH ACTIONS PANEL
   ========================================================================== */

export const AgentBuilderSlashActionsPanel = styled(View, {
  name: 'AgentBuilderSlashActionsPanel',
  display: 'flex',
  flexDirection: 'column',
  gap: '$3', // space-y-3 approximated as a column gap
})

export const AgentBuilderSlashActionsPanelHeader = styled(View, {
  name: 'AgentBuilderSlashActionsPanelHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

export const AgentBuilderSlashActionsPanelAddIcon = styled(View, {
  name: 'AgentBuilderSlashActionsPanelAddIcon',
  width: '$3.5', // w-3.5
  height: '$3.5',
})

export const AgentBuilderSlashActionsPanelEmpty = styled(View, {
  name: 'AgentBuilderSlashActionsPanelEmpty',
  textAlign: 'center',
  paddingVertical: '$6', // py-6
})

export const AgentBuilderSlashActionsPanelEmptyIconWrap = styled(View, {
  name: 'AgentBuilderSlashActionsPanelEmptyIconWrap',
  width: '$10',
  height: '$10',
  marginHorizontal: 'auto',
  marginBottom: '$2',
  borderRadius: '$radius-lg',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '$muted',
})

export const AgentBuilderSlashActionsPanelEmptyIcon = styled(View, {
  name: 'AgentBuilderSlashActionsPanelEmptyIcon',
  width: '$5',
  height: '$5',
  color: '$muted-foreground',
})

export const AgentBuilderSlashActionsPanelList = styled(View, {
  name: 'AgentBuilderSlashActionsPanelList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2', // space-y-2 approximated as a column gap
})

export const AgentBuilderSlashActionsPanelHelp = styled(View, {
  name: 'AgentBuilderSlashActionsPanelHelp',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '$2',
  padding: '$2',
  borderRadius: '$radius-lg',
  backgroundColor: 'color-mix(in srgb, var(--brand-1) 10%, transparent)',
})

export const AgentBuilderSlashActionsPanelHelpIcon = styled(View, {
  name: 'AgentBuilderSlashActionsPanelHelpIcon',
  width: '$4',
  height: '$4',
  marginTop: '$0.5', // mt-0.5
  flexShrink: 0,
  color: '$brand-1',
})

export const AgentBuilderSlashActionsPanelHelpCode = styled(Text, {
  name: 'AgentBuilderSlashActionsPanelHelpCode',
  // font-mono: no font-family token — applied by component
  fontWeight: '$semibold',
})

/* ==========================================================================
   THING PANEL
   ========================================================================== */

export const AgentBuilderThingPanel = styled(View, {
  name: 'AgentBuilderThingPanel',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  width: 352, // 22rem — no token
  borderLeftWidth: 1,
  borderLeftColor: '$border',
  backgroundColor: '$background',
  // transition: transform awaits the animation driver (§5/P4)
})

export const AgentBuilderThingPanelHeader = styled(View, {
  name: 'AgentBuilderThingPanelHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingVertical: '$3', // 0.75rem 1rem
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

export const AgentBuilderThingPanelHeaderLeft = styled(View, {
  name: 'AgentBuilderThingPanelHeaderLeft',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

export const AgentBuilderThingPanelHeaderIcon = styled(View, {
  name: 'AgentBuilderThingPanelHeaderIcon',
  width: '$4',
  height: '$4',
  color: '$agent',
})

export const AgentBuilderThingPanelCloseIcon = styled(View, {
  name: 'AgentBuilderThingPanelCloseIcon',
  width: 14, // 0.875rem
  height: 14,
})

export const AgentBuilderThingPanelBody = styled(View, {
  name: 'AgentBuilderThingPanelBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$8',
  color: '$muted-foreground',
})

export const AgentBuilderThingPanelBodyIcon = styled(View, {
  name: 'AgentBuilderThingPanelBodyIcon',
  width: '$10', // 2.5rem
  height: '$10',
  // stroke-width: 1 is an SVG attr — applied by component
  marginBottom: '$4',
})

export const AgentBuilderThingPanelBodyCaption = styled(Text, {
  name: 'AgentBuilderThingPanelBodyCaption',
  textAlign: 'center',
  maxWidth: 256, // 16rem
})

/* ==========================================================================
   TOOLS PANEL
   ========================================================================== */

export const AgentBuilderToolsPanel = styled(View, {
  name: 'AgentBuilderToolsPanel',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
})

export const AgentBuilderToolsPanelHeaderRow = styled(View, {
  name: 'AgentBuilderToolsPanelHeaderRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

export const AgentBuilderToolsPanelBody = styled(View, {
  name: 'AgentBuilderToolsPanelBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  padding: '$4',
})

export const AgentBuilderToolsPanelEmpty = styled(View, {
  name: 'AgentBuilderToolsPanelEmpty',
  textAlign: 'center',
  paddingVertical: '$12', // 3rem 0
})

export const AgentBuilderToolsPanelEmptyIcon = styled(Text, {
  name: 'AgentBuilderToolsPanelEmptyIcon',
  marginBottom: '$2',
  fontSize: 32, // 2rem
})

export const AgentBuilderToolsPanelEmptyCaption = styled(Text, {
  name: 'AgentBuilderToolsPanelEmptyCaption',
  marginHorizontal: 'auto',
  maxWidth: 200,
})

export const AgentBuilderToolsPanelEmptyBtn = styled(View, {
  name: 'AgentBuilderToolsPanelEmptyBtn',
  marginTop: '$4',
})

export const AgentBuilderToolsPanelFooterCaption = styled(Text, {
  name: 'AgentBuilderToolsPanelFooterCaption',
  textAlign: 'center',
  display: 'block',
})

export const AgentBuilderToolsPanelCardRow = styled(View, {
  name: 'AgentBuilderToolsPanelCardRow',
  display: 'flex',
  alignItems: 'flex-start',
})

export const AgentBuilderToolsPanelCardIcon = styled(View, {
  name: 'AgentBuilderToolsPanelCardIcon',
  flexShrink: 0,
  fontSize: 20, // 1.25rem
})

export const AgentBuilderToolsPanelCardContent = styled(View, {
  name: 'AgentBuilderToolsPanelCardContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

export const AgentBuilderToolsPanelCardTitleRow = styled(View, {
  name: 'AgentBuilderToolsPanelCardTitleRow',
  display: 'flex',
  alignItems: 'center',
  marginBottom: '$1',
})

export const AgentBuilderToolsPanelCardLabel = styled(Text, {
  name: 'AgentBuilderToolsPanelCardLabel',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

export const AgentBuilderToolsPanelCardDescription = styled(Text, {
  name: 'AgentBuilderToolsPanelCardDescription',
  overflow: 'hidden',
  // -webkit-line-clamp: 2 / -webkit-box — 2-line clamp, see the not-converted note at file tail
})

export const AgentBuilderToolsPanelCardMetaRow = styled(View, {
  name: 'AgentBuilderToolsPanelCardMetaRow',
  marginTop: '$2',
})

export const AgentBuilderToolsPanelCardActions = styled(View, {
  name: 'AgentBuilderToolsPanelCardActions',
  opacity: 0, // revealed on parent `.tools-panel__card:hover` — see the not-converted note at file tail
})

export const AgentBuilderToolsPanelBadgeSm = styled(Text, {
  name: 'AgentBuilderToolsPanelBadgeSm',
  fontSize: 10, // 0.625rem
})

/* ==========================================================================
   AREA KNOWLEDGE
   ========================================================================== */

export const AgentBuilderAreaKnowledgeHeading = styled(Text, {
  name: 'AgentBuilderAreaKnowledgeHeading',
  textTransform: 'uppercase',
  fontWeight: '$semibold',
  fontSize: 10, // 0.625rem
  letterSpacing: '0.05em',
  color: '$muted-foreground',
  marginBottom: '$3',
})

export const AgentBuilderAreaKnowledgeList = styled(View, {
  name: 'AgentBuilderAreaKnowledgeList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

export const AgentBuilderAreaKnowledgeCard = styled(View, {
  name: 'AgentBuilderAreaKnowledgeCard',
  overflow: 'hidden',
  borderWidth: 1,
  borderColor: '$border',
  borderRadius: '$radius-lg',
  // box-shadow: 0 1px 2px opaque-black-with-alpha
  shadowColor: 'rgba(0,0,0,0.04)',
  shadowOffset: { width: 0, height: 1 },
  shadowRadius: 2,
  // transition: border-color / box-shadow awaits the animation driver (§5/P4)
  hoverStyle: {
    borderColor: '$knowledge',
    shadowColor: 'color-mix(in srgb, var(--knowledge) 12%, transparent)',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
})

export const AgentBuilderAreaKnowledgeCardHeader = styled(View, {
  name: 'AgentBuilderAreaKnowledgeCardHeader',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  backgroundColor: 'transparent',
  borderWidth: 0,
  cursor: 'pointer',
  textAlign: 'left',
  gap: '$2.5', // 0.625rem
  paddingVertical: '$3', // 0.75rem 1rem
  paddingHorizontal: '$4',
})

export const AgentBuilderAreaKnowledgeCardFolderIcon = styled(View, {
  name: 'AgentBuilderAreaKnowledgeCardFolderIcon',
  flexShrink: 0,
  width: '$4',
  height: '$4',
  color: '$knowledge',
})

export const AgentBuilderAreaKnowledgeCardTitleWrap = styled(View, {
  name: 'AgentBuilderAreaKnowledgeCardTitleWrap',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

export const AgentBuilderAreaKnowledgeCardTitle = styled(Text, {
  name: 'AgentBuilderAreaKnowledgeCardTitle',
  display: 'block',
})

export const AgentBuilderAreaKnowledgeCardDescription = styled(Text, {
  name: 'AgentBuilderAreaKnowledgeCardDescription',
  display: 'block',
  marginTop: '$0.5', // 0.125rem
})

export const AgentBuilderAreaKnowledgeCardCount = styled(Text, {
  name: 'AgentBuilderAreaKnowledgeCardCount',
  flexShrink: 0,
})

export const AgentBuilderAreaKnowledgeCardChevron = styled(View, {
  name: 'AgentBuilderAreaKnowledgeCardChevron',
  flexShrink: 0,
  width: '$4',
  height: '$4',
  color: '$muted-foreground',
})

export const AgentBuilderAreaKnowledgeEntries = styled(View, {
  name: 'AgentBuilderAreaKnowledgeEntries',
  borderTopWidth: 1,
  borderTopColor: '$border',
  paddingTop: '$2', // 0.5rem 1rem 0.75rem
  paddingHorizontal: '$4',
  paddingBottom: '$3',
  backgroundColor: '$background',
})

export const AgentBuilderAreaKnowledgeEntriesList = styled(View, {
  name: 'AgentBuilderAreaKnowledgeEntriesList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
})

export const AgentBuilderAreaKnowledgeEntry = styled(View, {
  name: 'AgentBuilderAreaKnowledgeEntry',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingVertical: '$1', // 0.25rem 0
  fontSize: 13, // 0.8125rem
  color: '$muted-foreground',
})

export const AgentBuilderAreaKnowledgeEntryDot = styled(View, {
  name: 'AgentBuilderAreaKnowledgeEntryDot',
  flexShrink: 0,
  borderRadius: '$radius-full',
  width: '$1.5', // 0.375rem
  height: '$1.5',
  backgroundColor: '$knowledge',
})

export const AgentBuilderAreaKnowledgeEmptyEntries = styled(View, {
  name: 'AgentBuilderAreaKnowledgeEmptyEntries',
  borderTopWidth: 1,
  borderTopColor: '$border',
  padding: '$4',
})

/* ==========================================================================
   ASSISTANT FORM
   ========================================================================== */

export const AgentBuilderFormInstructionsTextarea = styled(View, {
  name: 'AgentBuilderFormInstructionsTextarea',
  // font-mono: no font-family token — applied by component. resize-y: web-only vertical resize.
  minHeight: 200,
})

export const AgentBuilderFormWorkflowCard = styled(View, {
  name: 'AgentBuilderFormWorkflowCard',
  cursor: 'pointer',
})

export const AgentBuilderFormWorkflowRow = styled(View, {
  name: 'AgentBuilderFormWorkflowRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/* --------------------------------------------------------------------------
   Idiomatic wrapper for the top-level `.agent-builder` shell. Sub-frames are
   composed by the caller (each exported above); this keeps parity with the
   shipped className AgentBuilder.
   -------------------------------------------------------------------------- */

export interface StyledAgentBuilderProps extends React.ComponentProps<'div'> {}

const Frame = AgentBuilder as unknown as React.ComponentType<any>

export function StyledAgentBuilder({ ...props }: StyledAgentBuilderProps) {
  return <Frame {...props} />
}

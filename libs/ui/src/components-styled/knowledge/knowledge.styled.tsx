/**
 * knowledge.styled.tsx — P2 conversion of the knowledge component CSS
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/components/knowledge/index.css —
 * a family of BEM blocks (CreateFieldInline, DeleteModal, DirectoryMetadataPanel, FieldTree,
 * NewFileModal, RenameModal, UnsavedChangesModal, TopicEditor, FileMetadataPanel, MarkdownPreview,
 * MarkdownToolbar, TopicViewer) — into idiomatic Tamagui `styled()` frames. One frame per BEM
 * selector; `--modifier` → variant. Every `name:` is prefixed `Knowledge` for global uniqueness.
 *
 * Lands alongside the shipped className components; knowledge-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/* ── CreateFieldInline ────────────────────────────────────────────── */

/** `.create-field-inline` — margin-bottom 1.5rem. */
export const KnowledgeCreateFieldInlineFrame = styled(View, {
  name: 'KnowledgeCreateFieldInline',
  marginBottom: '$6',
})

/** `.create-field-inline__header-row` — flex, justify-between, items-center. */
export const KnowledgeCreateFieldInlineHeaderRowFrame = styled(View, {
  name: 'KnowledgeCreateFieldInlineHeaderRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/** `.create-field-inline__title-row` — flex, items-center, gap 0.75rem. */
export const KnowledgeCreateFieldInlineTitleRowFrame = styled(View, {
  name: 'KnowledgeCreateFieldInlineTitleRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
})

/** `.create-field-inline__icon` — 1.25rem square. */
export const KnowledgeCreateFieldInlineIconFrame = styled(View, {
  name: 'KnowledgeCreateFieldInlineIcon',
  width: '$5',
  height: '$5',
})

/** `.create-field-inline__close-icon` — 1rem square. */
export const KnowledgeCreateFieldInlineCloseIconFrame = styled(View, {
  name: 'KnowledgeCreateFieldInlineCloseIcon',
  width: '$4',
  height: '$4',
})

/** `.create-field-inline__actions` — flex. */
export const KnowledgeCreateFieldInlineActionsFrame = styled(View, {
  name: 'KnowledgeCreateFieldInlineActions',
  display: 'flex',
})

/** `.create-field-inline__action-btn` — flex: 1. */
export const KnowledgeCreateFieldInlineActionBtnFrame = styled(View, {
  name: 'KnowledgeCreateFieldInlineActionBtn',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/* ── DeleteModal ──────────────────────────────────────────────────── */

/** `.delete-modal` — max-width 24rem. */
export const KnowledgeDeleteModalFrame = styled(View, {
  name: 'KnowledgeDeleteModal',
  maxWidth: 384,
})

/** `.delete-modal__header` — 2px bottom border in the destructive color. */
export const KnowledgeDeleteModalHeaderFrame = styled(View, {
  name: 'KnowledgeDeleteModalHeader',
  borderBottomWidth: 2,
  borderBottomColor: '$destructive',
})

/** `.delete-modal__header-content` — flex, items-center, gap 0.5rem. */
export const KnowledgeDeleteModalHeaderContentFrame = styled(View, {
  name: 'KnowledgeDeleteModalHeaderContent',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.delete-modal__warning-icon` — 1.125rem square, destructive color. */
export const KnowledgeDeleteModalWarningIconFrame = styled(View, {
  name: 'KnowledgeDeleteModalWarningIcon',
  width: 18, // 1.125rem — no size token
  height: 18,
  color: '$destructive',
})

/** `.delete-modal__title` — destructive color (text). */
export const KnowledgeDeleteModalTitleFrame = styled(Text, {
  name: 'KnowledgeDeleteModalTitle',
  color: '$destructive',
})

/** `.delete-modal__close-icon` — 1rem square. */
export const KnowledgeDeleteModalCloseIconFrame = styled(View, {
  name: 'KnowledgeDeleteModalCloseIcon',
  width: '$4',
  height: '$4',
})

/** `.delete-modal__body` — padding 0 1.5rem. */
export const KnowledgeDeleteModalBodyFrame = styled(View, {
  name: 'KnowledgeDeleteModalBody',
  paddingVertical: 0,
  paddingHorizontal: '$6',
})

/** `.delete-modal__note` — margin-top 0.5rem, block. */
export const KnowledgeDeleteModalNoteFrame = styled(Text, {
  name: 'KnowledgeDeleteModalNote',
  marginTop: '$2',
  display: 'block',
})

/** `.delete-modal__footer` — flex, justify-end, gap 0.75rem, padding 1rem 1.5rem, top border, mt 1rem. */
export const KnowledgeDeleteModalFooterFrame = styled(View, {
  name: 'KnowledgeDeleteModalFooter',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$3',
  paddingVertical: '$4',
  paddingHorizontal: '$6',
  borderTopWidth: 1,
  borderTopColor: '$border',
  marginTop: '$4',
})

/* ── DirectoryMetadataPanel ───────────────────────────────────────── */

/** `.dir-metadata` — padding 1.5rem, max-width 32rem. */
export const KnowledgeDirMetadataFrame = styled(View, {
  name: 'KnowledgeDirMetadata',
  padding: '$6',
  maxWidth: 512,
})

/** `.dir-metadata__header` — items-center, gap 0.75rem (no `flex!`). */
export const KnowledgeDirMetadataHeaderFrame = styled(View, {
  name: 'KnowledgeDirMetadataHeader',
  alignItems: 'center',
  gap: '$3',
})

/** `.dir-metadata__icon` — 1.5rem square, muted-foreground. */
export const KnowledgeDirMetadataIconFrame = styled(View, {
  name: 'KnowledgeDirMetadataIcon',
  width: '$6',
  height: '$6',
  color: '$muted-foreground',
})

/** `.dir-metadata__color-row` — flex, items-center, gap 0.5rem. */
export const KnowledgeDirMetadataColorRowFrame = styled(View, {
  name: 'KnowledgeDirMetadataColorRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.dir-metadata__color-input` — flex: 1. */
export const KnowledgeDirMetadataColorInputFrame = styled(View, {
  name: 'KnowledgeDirMetadataColorInput',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.dir-metadata__color-swatch` — 2rem square, radius 4px, 1px border, no shrink. */
export const KnowledgeDirMetadataColorSwatchFrame = styled(View, {
  name: 'KnowledgeDirMetadataColorSwatch',
  width: '$8',
  height: '$8',
  borderRadius: 4, // 0.25rem
  borderWidth: 1,
  borderColor: '$border',
  flexShrink: 0,
})

/** `.dir-metadata__checkbox-row` — flex, items-center, gap 0.5rem. */
export const KnowledgeDirMetadataCheckboxRowFrame = styled(View, {
  name: 'KnowledgeDirMetadataCheckboxRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.dir-metadata__checkbox-label` — margin 0. */
export const KnowledgeDirMetadataCheckboxLabelFrame = styled(Text, {
  name: 'KnowledgeDirMetadataCheckboxLabel',
  margin: 0,
})

/** `.dir-metadata__footer` — flex, justify-end, padding-top 0.5rem. */
export const KnowledgeDirMetadataFooterFrame = styled(View, {
  name: 'KnowledgeDirMetadataFooter',
  display: 'flex',
  justifyContent: 'flex-end',
  paddingTop: '$2',
})

/* ── FieldTree (container) ────────────────────────────────────────── */

/** `.field-tree` — relative, full height + width. */
export const KnowledgeFieldTreeFrame = styled(View, {
  name: 'KnowledgeFieldTree',
  position: 'relative',
  height: '100%',
  width: '100%',
})

/** `.field-tree__edit-input` — flex: 1. */
export const KnowledgeFieldTreeEditInputFrame = styled(View, {
  name: 'KnowledgeFieldTreeEditInput',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/* ── NewFileModal / NewFolderModal ─────────────────────────────────── */

/** `.new-file-modal` — max-width 28rem. */
export const KnowledgeNewFileModalFrame = styled(View, {
  name: 'KnowledgeNewFileModal',
  maxWidth: 448,
})

/** `.new-file-modal__title` — success color (text). */
export const KnowledgeNewFileModalTitleFrame = styled(Text, {
  name: 'KnowledgeNewFileModalTitle',
  color: '$success',
})

/** `.new-file-modal__close-icon` — 1rem square. */
export const KnowledgeNewFileModalCloseIconFrame = styled(View, {
  name: 'KnowledgeNewFileModalCloseIcon',
  width: '$4',
  height: '$4',
})

/** `.new-file-modal__fields` — padding 0 1.5rem. */
export const KnowledgeNewFileModalFieldsFrame = styled(View, {
  name: 'KnowledgeNewFileModalFields',
  paddingVertical: 0,
  paddingHorizontal: '$6',
})

/** `.new-file-modal__hint` — text-xs, muted-foreground, mt 0.25rem, block. */
export const KnowledgeNewFileModalHintFrame = styled(Text, {
  name: 'KnowledgeNewFileModalHint',
  fontSize: '$xs', // 0.75rem
  color: '$muted-foreground',
  marginTop: '$1',
  display: 'block',
})

/** `.new-file-modal__select` — width 100%. */
export const KnowledgeNewFileModalSelectFrame = styled(View, {
  name: 'KnowledgeNewFileModalSelect',
  width: '100%',
})

/** `.new-file-modal__footer` — flex, justify-end, gap 0.75rem, padding 1rem 1.5rem, top border, mt 1rem. */
export const KnowledgeNewFileModalFooterFrame = styled(View, {
  name: 'KnowledgeNewFileModalFooter',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$3',
  paddingVertical: '$4',
  paddingHorizontal: '$6',
  borderTopWidth: 1,
  borderTopColor: '$border',
  marginTop: '$4',
})

/** `.new-file-modal__create-btn` — success surface. */
export const KnowledgeNewFileModalCreateBtnFrame = styled(View, {
  name: 'KnowledgeNewFileModalCreateBtn',
  backgroundColor: '$success',
})

/* ── RenameModal ──────────────────────────────────────────────────── */

/** `.rename-modal` — max-width 24rem. */
export const KnowledgeRenameModalFrame = styled(View, {
  name: 'KnowledgeRenameModal',
  maxWidth: 384,
})

/** `.rename-modal__close-icon` — 1rem square. */
export const KnowledgeRenameModalCloseIconFrame = styled(View, {
  name: 'KnowledgeRenameModalCloseIcon',
  width: '$4',
  height: '$4',
})

/** `.rename-modal__body` — padding 0 1.5rem. */
export const KnowledgeRenameModalBodyFrame = styled(View, {
  name: 'KnowledgeRenameModalBody',
  paddingVertical: 0,
  paddingHorizontal: '$6',
})

/** `.rename-modal__error` — destructive color, mt 0.25rem, block. */
export const KnowledgeRenameModalErrorFrame = styled(Text, {
  name: 'KnowledgeRenameModalError',
  color: '$destructive',
  marginTop: '$1',
  display: 'block',
})

/** `.rename-modal__footer` — flex, justify-end, gap 0.75rem, padding 1rem 1.5rem, top border, mt 1rem. */
export const KnowledgeRenameModalFooterFrame = styled(View, {
  name: 'KnowledgeRenameModalFooter',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$3',
  paddingVertical: '$4',
  paddingHorizontal: '$6',
  borderTopWidth: 1,
  borderTopColor: '$border',
  marginTop: '$4',
})

/* ── UnsavedChangesModal ──────────────────────────────────────────── */

/** `.unsaved-modal` — max-width 24rem. */
export const KnowledgeUnsavedModalFrame = styled(View, {
  name: 'KnowledgeUnsavedModal',
  maxWidth: 384,
})

/** `.unsaved-modal__header-content` — flex, items-center, gap 0.5rem. */
export const KnowledgeUnsavedModalHeaderContentFrame = styled(View, {
  name: 'KnowledgeUnsavedModalHeaderContent',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.unsaved-modal__warning-icon` — 1.125rem square, warning color. */
export const KnowledgeUnsavedModalWarningIconFrame = styled(View, {
  name: 'KnowledgeUnsavedModalWarningIcon',
  width: 18, // 1.125rem — no size token
  height: 18,
  color: '$warning',
})

/** `.unsaved-modal__close-icon` — 1rem square. */
export const KnowledgeUnsavedModalCloseIconFrame = styled(View, {
  name: 'KnowledgeUnsavedModalCloseIcon',
  width: '$4',
  height: '$4',
})

/** `.unsaved-modal__body` — padding 0 1.5rem. */
export const KnowledgeUnsavedModalBodyFrame = styled(View, {
  name: 'KnowledgeUnsavedModalBody',
  paddingVertical: 0,
  paddingHorizontal: '$6',
})

/** `.unsaved-modal__footer` — flex, justify-end, gap 0.75rem, padding 1rem 1.5rem, top border, mt 1rem. */
export const KnowledgeUnsavedModalFooterFrame = styled(View, {
  name: 'KnowledgeUnsavedModalFooter',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$3',
  paddingVertical: '$4',
  paddingHorizontal: '$6',
  borderTopWidth: 1,
  borderTopColor: '$border',
  marginTop: '$4',
})

/* ── TopicEditor ──────────────────────────────────────────────────── */

/** `.topic-editor__header` — flex, justify-between, items-center. */
export const KnowledgeTopicEditorHeaderFrame = styled(View, {
  name: 'KnowledgeTopicEditorHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/** `.topic-editor__header-actions` — flex, items-center, gap 0.5rem. */
export const KnowledgeTopicEditorHeaderActionsFrame = styled(View, {
  name: 'KnowledgeTopicEditorHeaderActions',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/**
 * `.topic-editor__metadata-btn` — no base rule; only the `--active` modifier exists
 * (`--active` = muted surface), modeled as an `active` variant applied by the component.
 */
export const KnowledgeTopicEditorMetadataBtnFrame = styled(View, {
  name: 'KnowledgeTopicEditorMetadataBtn',

  variants: {
    active: {
      true: { backgroundColor: '$muted' },
    },
  } as const,
})

/** `.topic-editor__settings-icon` — 0.875rem square. */
export const KnowledgeTopicEditorSettingsIconFrame = styled(View, {
  name: 'KnowledgeTopicEditorSettingsIcon',
  width: '$3.5',
  height: '$3.5',
})

/** `.topic-editor__container` — 1px border, radius 6px, overflow hidden. */
export const KnowledgeTopicEditorContainerFrame = styled(View, {
  name: 'KnowledgeTopicEditorContainer',
  borderWidth: 1,
  borderColor: '$border',
  borderRadius: 6, // 0.375rem
  overflow: 'hidden',
})

/** `.topic-editor__textarea` — full width, viewport-relative height, monospace editor surface. */
export const KnowledgeTopicEditorTextareaFrame = styled(View, {
  name: 'KnowledgeTopicEditorTextarea',
  width: '100%',
  height: 'calc(100vh - 14rem)',
  fontFamily: 'monospace',
  fontSize: '$sm', // 0.875rem
  lineHeight: '1.6' as unknown as number,
  resize: 'none',
  borderWidth: 0, // border: none
  outlineStyle: 'none', // outline: none
  padding: '$4',
  borderRadius: 0,
})

/* ── FileMetadataPanel ────────────────────────────────────────────── */

/** `.file-metadata` — 1px bottom border, padding 0.75rem 1rem, muted surface. */
export const KnowledgeFileMetadataFrame = styled(View, {
  name: 'KnowledgeFileMetadata',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  paddingVertical: '$3',
  paddingHorizontal: '$4',
  backgroundColor: '$muted',
})

/** `.file-metadata__footer` — flex, justify-end. */
export const KnowledgeFileMetadataFooterFrame = styled(View, {
  name: 'KnowledgeFileMetadataFooter',
  display: 'flex',
  justifyContent: 'flex-end',
})

/* ── MarkdownPreview ──────────────────────────────────────────────── */

/** `.markdown-preview` — padding 1rem, system font, foreground text, viewport height, scroll. */
export const KnowledgeMarkdownPreviewFrame = styled(View, {
  name: 'KnowledgeMarkdownPreview',
  padding: '$4',
  lineHeight: '1.7' as unknown as number,
  fontSize: '$sm', // 0.875rem
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '$foreground',
  height: 'calc(100vh - 14rem)',
  overflow: 'auto',
  wordWrap: 'break-word',
})

/* ── MarkdownToolbar ──────────────────────────────────────────────── */

/** `.markdown-toolbar` — flex, items-center, flex-wrap, gap 0.125rem, padding 0.25rem 0.5rem, bottom border. */
export const KnowledgeMarkdownToolbarFrame = styled(View, {
  name: 'KnowledgeMarkdownToolbar',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '$0.5',
  paddingVertical: '$1',
  paddingHorizontal: '$2',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/** `.markdown-toolbar__separator` — 1px × 1.25rem hairline, muted-border surface, mx 0.25rem. */
export const KnowledgeMarkdownToolbarSeparatorFrame = styled(View, {
  name: 'KnowledgeMarkdownToolbarSeparator',
  width: 1,
  height: '$5',
  backgroundColor: '$border',
  marginVertical: 0,
  marginHorizontal: '$1',
})

/** `.markdown-toolbar__spacer` — flex: 1. */
export const KnowledgeMarkdownToolbarSpacerFrame = styled(View, {
  name: 'KnowledgeMarkdownToolbarSpacer',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.markdown-toolbar__modes` — flex, gap 0.125rem. */
export const KnowledgeMarkdownToolbarModesFrame = styled(View, {
  name: 'KnowledgeMarkdownToolbarModes',
  display: 'flex',
  gap: '$0.5',
})

/** `.markdown-toolbar__mode-btn` — gap 0.25rem. */
export const KnowledgeMarkdownToolbarModeBtnFrame = styled(View, {
  name: 'KnowledgeMarkdownToolbarModeBtn',
  gap: '$1',
})

/** `.markdown-toolbar__icon` — 0.875rem square. */
export const KnowledgeMarkdownToolbarIconFrame = styled(View, {
  name: 'KnowledgeMarkdownToolbarIcon',
  width: '$3.5',
  height: '$3.5',
})

/** `.markdown-toolbar__mode-icon` — 0.75rem square. */
export const KnowledgeMarkdownToolbarModeIconFrame = styled(View, {
  name: 'KnowledgeMarkdownToolbarModeIcon',
  width: '$3',
  height: '$3',
})

/* ── TopicViewer ──────────────────────────────────────────────────── */

/** `.topic-viewer__empty` — flex, flex-col, items-center, justify-center, padding 3rem. */
export const KnowledgeTopicViewerEmptyFrame = styled(View, {
  name: 'KnowledgeTopicViewerEmpty',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$12',
})

/** `.topic-viewer__empty-caption` — max-width 24rem, centered text. */
export const KnowledgeTopicViewerEmptyCaptionFrame = styled(Text, {
  name: 'KnowledgeTopicViewerEmptyCaption',
  maxWidth: 384,
  textAlign: 'center',
})

/** `.topic-viewer__empty-fields` — mt 1rem, flex, flex-wrap, justify-center. */
export const KnowledgeTopicViewerEmptyFieldsFrame = styled(View, {
  name: 'KnowledgeTopicViewerEmptyFields',
  marginTop: '$4',
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
})

/** `.topic-viewer__header` — flex, justify-between, items-center. */
export const KnowledgeTopicViewerHeaderFrame = styled(View, {
  name: 'KnowledgeTopicViewerHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/** `.topic-viewer__header-actions` — flex, items-center, gap 0.5rem. */
export const KnowledgeTopicViewerHeaderActionsFrame = styled(View, {
  name: 'KnowledgeTopicViewerHeaderActions',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.topic-viewer__textarea` — full width, viewport-relative height, monospace surface. */
export const KnowledgeTopicViewerTextareaFrame = styled(View, {
  name: 'KnowledgeTopicViewerTextarea',
  width: '100%',
  height: 'calc(100vh - 10rem)',
  fontFamily: 'monospace',
  fontSize: '$sm', // 0.875rem
  lineHeight: '1.6' as unknown as number,
  resize: 'none',
  borderWidth: 0, // border: none
  outlineStyle: 'none', // outline: none
  padding: '$4',
})

/* ── Styled wrappers (representative top-level blocks + the one variant) ─────────── */

const DeleteModal = KnowledgeDeleteModalFrame as unknown as React.ComponentType<any>
const DirMetadata = KnowledgeDirMetadataFrame as unknown as React.ComponentType<any>
const FieldTree = KnowledgeFieldTreeFrame as unknown as React.ComponentType<any>
const Toolbar = KnowledgeMarkdownToolbarFrame as unknown as React.ComponentType<any>
const TopicViewerEmpty = KnowledgeTopicViewerEmptyFrame as unknown as React.ComponentType<any>
const MetadataBtn = KnowledgeTopicEditorMetadataBtnFrame as unknown as React.ComponentType<any>

export interface StyledKnowledgeMetadataBtnProps extends React.ComponentProps<'div'> {
  active?: boolean
}

/** Idiomatic DeleteModal shell (`.delete-modal`). */
export function StyledKnowledgeDeleteModal(props: React.ComponentProps<'div'>) {
  return <DeleteModal {...props} />
}
/** Idiomatic DirectoryMetadataPanel shell (`.dir-metadata`). */
export function StyledKnowledgeDirMetadata(props: React.ComponentProps<'div'>) {
  return <DirMetadata {...props} />
}
/** Idiomatic FieldTree container (`.field-tree`). */
export function StyledKnowledgeFieldTree(props: React.ComponentProps<'div'>) {
  return <FieldTree {...props} />
}
/** Idiomatic MarkdownToolbar shell (`.markdown-toolbar`). */
export function StyledKnowledgeMarkdownToolbar(props: React.ComponentProps<'div'>) {
  return <Toolbar {...props} />
}
/** Idiomatic TopicViewer empty state (`.topic-viewer__empty`). */
export function StyledKnowledgeTopicViewerEmpty(props: React.ComponentProps<'div'>) {
  return <TopicViewerEmpty {...props} />
}
/** Idiomatic TopicEditor metadata button — carries the `active` (`--active`) variant. */
export function StyledKnowledgeTopicEditorMetadataBtn({ active, ...props }: StyledKnowledgeMetadataBtnProps) {
  return <MetadataBtn active={active} {...props} />
}

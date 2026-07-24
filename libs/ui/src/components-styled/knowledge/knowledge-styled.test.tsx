import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  KnowledgeDeleteModalFrame,
  KnowledgeDeleteModalHeaderFrame,
  KnowledgeDeleteModalFooterFrame,
  KnowledgeDirMetadataFrame,
  KnowledgeDirMetadataColorSwatchFrame,
  KnowledgeFieldTreeFrame,
  KnowledgeNewFileModalFrame,
  KnowledgeNewFileModalHintFrame,
  KnowledgeMarkdownToolbarFrame,
  KnowledgeMarkdownToolbarSeparatorFrame,
  KnowledgeTopicEditorMetadataBtnFrame,
  KnowledgeTopicEditorTextareaFrame,
  KnowledgeFileMetadataFrame,
  KnowledgeTopicViewerEmptyFrame,
  StyledKnowledgeDeleteModal,
  StyledKnowledgeDirMetadata,
  StyledKnowledgeFieldTree,
  StyledKnowledgeMarkdownToolbar,
  StyledKnowledgeTopicViewerEmpty,
  StyledKnowledgeTopicEditorMetadataBtn,
} from './knowledge.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const cfg = (f: unknown) => (f as { staticConfig: any }).staticConfig

/** P2 proof gate — the `knowledge` BEM family ⇄ styled() frames (docs §4). */
describe('knowledge → styled() base tokens', () => {
  it('.delete-modal is a 24rem shell', () => {
    expect(cfg(KnowledgeDeleteModalFrame).defaultProps).toMatchObject({ maxWidth: 384 })
  })

  it('.delete-modal__header carries the 2px destructive bottom border', () => {
    expect(cfg(KnowledgeDeleteModalHeaderFrame).defaultProps).toMatchObject({
      borderBottomWidth: 2,
      borderBottomColor: '$destructive',
    })
  })

  it('.delete-modal__footer is a bordered justify-end row', () => {
    expect(cfg(KnowledgeDeleteModalFooterFrame).defaultProps).toMatchObject({
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '$3',
      borderTopWidth: 1,
      borderTopColor: '$border',
    })
  })

  it('.dir-metadata pads 1.5rem and caps at 32rem', () => {
    expect(cfg(KnowledgeDirMetadataFrame).defaultProps).toMatchObject({ padding: '$6', maxWidth: 512 })
  })

  it('.dir-metadata__color-swatch is a 2rem bordered square that never shrinks', () => {
    expect(cfg(KnowledgeDirMetadataColorSwatchFrame).defaultProps).toMatchObject({
      width: '$8',
      height: '$8',
      borderRadius: 4,
      borderColor: '$border',
      flexShrink: 0,
    })
  })

  it('.field-tree is a relative full-size container', () => {
    expect(cfg(KnowledgeFieldTreeFrame).defaultProps).toMatchObject({
      position: 'relative',
      height: '100%',
      width: '100%',
    })
  })

  it('.new-file-modal is a 28rem shell', () => {
    expect(cfg(KnowledgeNewFileModalFrame).defaultProps).toMatchObject({ maxWidth: 448 })
  })

  it('.new-file-modal__hint is a muted text-xs block', () => {
    expect(cfg(KnowledgeNewFileModalHintFrame).defaultProps).toMatchObject({
      fontSize: '$xs',
      color: '$muted-foreground',
      display: 'block',
    })
  })

  it('.markdown-toolbar is a wrapping bordered flex row', () => {
    expect(cfg(KnowledgeMarkdownToolbarFrame).defaultProps).toMatchObject({
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '$0.5',
      borderBottomColor: '$border',
    })
  })

  it('.markdown-toolbar__separator is a 1px hairline on the border color', () => {
    expect(cfg(KnowledgeMarkdownToolbarSeparatorFrame).defaultProps).toMatchObject({
      width: 1,
      height: '$5',
      backgroundColor: '$border',
    })
  })

  it('.file-metadata is a muted-surface bottom-bordered panel', () => {
    expect(cfg(KnowledgeFileMetadataFrame).defaultProps).toMatchObject({
      borderBottomWidth: 1,
      backgroundColor: '$muted',
    })
  })

  it('.topic-editor__textarea drops border/outline for a monospace editor', () => {
    expect(cfg(KnowledgeTopicEditorTextareaFrame).defaultProps).toMatchObject({
      width: '100%',
      fontFamily: 'monospace',
      fontSize: '$sm',
      borderWidth: 0,
      outlineStyle: 'none',
    })
  })

  it('.topic-viewer__empty is a centered column with 3rem padding', () => {
    expect(cfg(KnowledgeTopicViewerEmptyFrame).defaultProps).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '$12',
    })
  })
})

describe('knowledge variants', () => {
  it('.topic-editor__metadata-btn--active → muted surface', () => {
    expect(cfg(KnowledgeTopicEditorMetadataBtnFrame).variants.active.true).toMatchObject({
      backgroundColor: '$muted',
    })
  })
})

describe('Styled knowledge frames render', () => {
  it('renders each top-level block with its `.is_<Name>` marker', () => {
    const { container } = render(
      <P>
        <StyledKnowledgeDeleteModal />
        <StyledKnowledgeDirMetadata />
        <StyledKnowledgeFieldTree />
        <StyledKnowledgeMarkdownToolbar />
        <StyledKnowledgeTopicViewerEmpty />
        <StyledKnowledgeTopicEditorMetadataBtn active />
      </P>,
    )
    expect(container.querySelector('.is_KnowledgeDeleteModal')).toBeTruthy()
    expect(container.querySelector('.is_KnowledgeDirMetadata')).toBeTruthy()
    expect(container.querySelector('.is_KnowledgeFieldTree')).toBeTruthy()
    expect(container.querySelector('.is_KnowledgeMarkdownToolbar')).toBeTruthy()
    expect(container.querySelector('.is_KnowledgeTopicViewerEmpty')).toBeTruthy()
    expect(container.querySelector('.is_KnowledgeTopicEditorMetadataBtn')).toBeTruthy()
  })
})

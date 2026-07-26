import * as Prim from '../../../../elements/primitives/index';
import { Button } from '../../../../elements/forms/button'
import {
  Bold,
  Italic,
  Heading1,
  List,
  ListOrdered,
  Code,
  Code2,
  Link,
  Quote,
  Minus,
  Eye,
  Pencil,
} from 'lucide-react'
import { MARKDOWN_TOOLBAR_ICON, MARKDOWN_TOOLBAR_MODE_BTN, MARKDOWN_TOOLBAR_MODE_ICON } from '../../props'

export type FormatAction =
  | 'bold'
  | 'italic'
  | 'heading'
  | 'bullet-list'
  | 'numbered-list'
  | 'inline-code'
  | 'code-block'
  | 'link'
  | 'blockquote'
  | 'hr'

export type EditorMode = 'edit' | 'preview'

interface MarkdownToolbarProps {
  mode: EditorMode
  onFormat: (action: FormatAction) => void
  onModeChange: (mode: EditorMode) => void
}

export function MarkdownToolbar({ mode, onFormat, onModeChange }: MarkdownToolbarProps) {
  return (
    <Prim.Box display="flex" alignItems="center" flexWrap="wrap" gap="$0.5" paddingVertical="$1" paddingHorizontal="$2" borderBottomWidth={1} borderBottomColor="$border">
      <Button variant="ghost" size="icon" onClick={() => onFormat('bold')} title="Bold (Ctrl+B)" disabled={mode === 'preview'}>
        <Bold {...MARKDOWN_TOOLBAR_ICON} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onFormat('italic')} title="Italic (Ctrl+I)" disabled={mode === 'preview'}>
        <Italic {...MARKDOWN_TOOLBAR_ICON} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onFormat('heading')} title="Heading" disabled={mode === 'preview'}>
        <Heading1 {...MARKDOWN_TOOLBAR_ICON} />
      </Button>

      <Prim.Text width={1} height="$5" backgroundColor="$border" marginVertical={0} marginHorizontal="$1" />

      <Button variant="ghost" size="icon" onClick={() => onFormat('bullet-list')} title="Bullet list" disabled={mode === 'preview'}>
        <List {...MARKDOWN_TOOLBAR_ICON} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onFormat('numbered-list')} title="Numbered list" disabled={mode === 'preview'}>
        <ListOrdered {...MARKDOWN_TOOLBAR_ICON} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onFormat('blockquote')} title="Blockquote" disabled={mode === 'preview'}>
        <Quote {...MARKDOWN_TOOLBAR_ICON} />
      </Button>

      <Prim.Text width={1} height="$5" backgroundColor="$border" marginVertical={0} marginHorizontal="$1" />

      <Button variant="ghost" size="icon" onClick={() => onFormat('inline-code')} title="Inline code" disabled={mode === 'preview'}>
        <Code {...MARKDOWN_TOOLBAR_ICON} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onFormat('code-block')} title="Code block" disabled={mode === 'preview'}>
        <Code2 {...MARKDOWN_TOOLBAR_ICON} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onFormat('link')} title="Link" disabled={mode === 'preview'}>
        <Link {...MARKDOWN_TOOLBAR_ICON} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onFormat('hr')} title="Horizontal rule" disabled={mode === 'preview'}>
        <Minus {...MARKDOWN_TOOLBAR_ICON} />
      </Button>

      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" />

      <Prim.Box display="flex" gap="$0.5">
        <Button
          variant={mode === 'edit' ? 'outline' : 'ghost'}
          size="sm"
          onClick={() => onModeChange('edit')}
          {...MARKDOWN_TOOLBAR_MODE_BTN}
        >
          <Pencil {...MARKDOWN_TOOLBAR_MODE_ICON} />
          Edit
        </Button>
        <Button
          variant={mode === 'preview' ? 'outline' : 'ghost'}
          size="sm"
          onClick={() => onModeChange('preview')}
          {...MARKDOWN_TOOLBAR_MODE_BTN}
        >
          <Eye {...MARKDOWN_TOOLBAR_MODE_ICON} />
          Preview
        </Button>
      </Prim.Box>
    </Prim.Box>
  )
}

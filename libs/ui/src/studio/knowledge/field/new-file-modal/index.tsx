import * as Prim from '../../../../elements/primitives/index.js';
import { useCallback } from 'react'
import { useUIState } from '@lmthing/state'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { X } from 'lucide-react'
import { INPUT_BASE } from '../../../../elements/forms/input/index.js'
import { DIALOG_BACKDROP, DIALOG_BASE, DIALOG_CONTENT, DIALOG_HEADER } from '../../../../elements/overlays/dialog/index.js'
import { NEW_FILE_MODAL_CLOSE_ICON, NEW_FILE_MODAL_CREATE_BTN, NEW_FILE_MODAL_FIELDS, NEW_FILE_MODAL_SELECT, NEW_FILE_MODAL_TITLE } from '../../props.js'

// Local type — replaces deprecated KnowledgeNode
interface KnowledgeNode {
  path: string
  type: 'directory' | 'file'
  children?: KnowledgeNode[]
}

interface NewFileModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (filename: string, location: string) => void
  folders: { path: string; label: string }[]
  defaultLocation: string
}

export function NewFileModal({ isOpen, onClose, onCreate, folders, defaultLocation }: NewFileModalProps) {
  const [filename, setFilename] = useUIState<string>('new-file-modal.filename', '')
  const [location, setLocation] = useUIState<string>('new-file-modal.location', defaultLocation)

  const handleCreate = useCallback(() => {
    if (!filename.trim()) return
    const name = filename.trim().endsWith('.md') ? filename.trim() : `${filename.trim()}.md`
    onCreate(name, location)
    setFilename('')
    setLocation(defaultLocation)
    onClose()
  }, [filename, location, onCreate, onClose, defaultLocation])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreate()
  }, [onClose, handleCreate])

  if (!isOpen) return null

  return (
    <Prim.Box {...DIALOG_BACKDROP} onClick={onClose} onKeyDown={handleKeyDown}>
      <Prim.Box
        {...DIALOG_BASE}
        maxWidth={448}
        onClick={e => e.stopPropagation()}
      >
        <Prim.Box {...DIALOG_HEADER}>
          <Heading level={3} {...NEW_FILE_MODAL_TITLE}>New Prompt Fragment</Heading>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X {...NEW_FILE_MODAL_CLOSE_ICON} />
          </Button>
        </Prim.Box>

        <Prim.Box {...DIALOG_CONTENT}>
          <Stack gap="md" {...NEW_FILE_MODAL_FIELDS}>
            <Prim.Box>
              <Label>Filename</Label>
              <Input
                type="text"
                value={filename}
                onChange={e => setFilename(e.target.value)}
                placeholder="my-prompt.md"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate()
                }}
              />
              <Prim.Text fontSize="$xs" color="$muted-foreground" marginTop="$1" display="block">
                .md extension will be added automatically
              </Prim.Text>
            </Prim.Box>

            <Prim.Box>
              <Label>Location</Label>
              <Prim.Select
                {...INPUT_BASE} {...NEW_FILE_MODAL_SELECT}
                value={location}
                onChange={e => setLocation(e.target.value)}
              >
                <Prim.Option value={defaultLocation}>/  (root)</Prim.Option>
                {folders.map(f => (
                  <Prim.Option key={f.path} value={f.path}>
                    {f.label}
                  </Prim.Option>
                ))}
              </Prim.Select>
            </Prim.Box>
          </Stack>

          <Prim.Box display="flex" justifyContent="flex-end" gap="$3" paddingVertical="$4" paddingHorizontal="$6" borderTopWidth={1} borderTopColor="$border" marginTop="$4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={!filename.trim()}
              {...NEW_FILE_MODAL_CREATE_BTN}
            >
              Create
            </Button>
          </Prim.Box>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

export function collectFolders(nodes: KnowledgeNode[], prefix = ''): { path: string; label: string }[] {
  const result: { path: string; label: string }[] = []
  for (const node of nodes) {
    if (node.type === 'directory') {
      const name = node.path.split('/').pop() || node.path
      const label = prefix ? `${prefix} / ${name}` : name
      result.push({ path: node.path, label })
      if (node.children) {
        result.push(...collectFolders(node.children, label))
      }
    }
  }
  return result
}

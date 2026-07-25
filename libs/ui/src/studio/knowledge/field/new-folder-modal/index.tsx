import * as Prim from '../../../../elements/primitives/index.js';
import { useCallback } from 'react'
import { useUIState } from '@lmthing/state'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { X } from 'lucide-react'
import { collectFolders } from '../new-file-modal'
import { INPUT_BASE } from '../../../../elements/forms/input/index.js'
import { DIALOG_BACKDROP, DIALOG_BASE, DIALOG_CONTENT, DIALOG_HEADER } from '../../../../elements/overlays/dialog/index.js'
import { NEW_FILE_MODAL_CLOSE_ICON, NEW_FILE_MODAL_CREATE_BTN, NEW_FILE_MODAL_FIELDS, NEW_FILE_MODAL_SELECT, NEW_FILE_MODAL_TITLE } from '../../props.js'

interface NewFolderModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (folderName: string, parentLocation: string) => void
  folders: { path: string; label: string }[]
  defaultLocation: string
}

export function NewFolderModal({ isOpen, onClose, onCreate, folders, defaultLocation }: NewFolderModalProps) {
  const [folderName, setFolderName] = useUIState<string>('new-folder-modal.folder-name', '')
  const [parentLocation, setParentLocation] = useUIState<string>('new-folder-modal.parent-location', defaultLocation)

  const handleCreate = useCallback(() => {
    if (!folderName.trim()) return
    onCreate(folderName.trim(), parentLocation)
    setFolderName('')
    setParentLocation(defaultLocation)
    onClose()
  }, [folderName, parentLocation, onCreate, onClose, defaultLocation])

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
          <Heading level={3} {...NEW_FILE_MODAL_TITLE}>New Folder</Heading>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X {...NEW_FILE_MODAL_CLOSE_ICON} />
          </Button>
        </Prim.Box>

        <Prim.Box {...DIALOG_CONTENT}>
          <Stack gap="md" {...NEW_FILE_MODAL_FIELDS}>
            <Prim.Box>
              <Label>Folder Name</Label>
              <Input
                type="text"
                value={folderName}
                onChange={e => setFolderName(e.target.value)}
                placeholder="my-folder"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate()
                }}
              />
            </Prim.Box>

            <Prim.Box>
              <Label>Parent Location</Label>
              <Prim.Select
                {...INPUT_BASE} {...NEW_FILE_MODAL_SELECT}
                value={parentLocation}
                onChange={e => setParentLocation(e.target.value)}
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
              disabled={!folderName.trim()}
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

export { collectFolders }

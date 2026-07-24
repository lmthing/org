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
import '@lmthing/css/components/knowledge/index.css'

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
    <Prim.Box className="dialog__backdrop" onClick={onClose} onKeyDown={handleKeyDown}>
      <Prim.Box
        className="dialog"
        maxWidth={448}
        onClick={e => e.stopPropagation()}
      >
        <Prim.Box className="dialog__header">
          <Heading level={3} className="new-file-modal__title">New Folder</Heading>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="new-file-modal__close-icon" />
          </Button>
        </Prim.Box>

        <Prim.Box className="dialog__content">
          <Stack gap="md" className="new-file-modal__fields">
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
                className="input new-file-modal__select"
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
              className="new-file-modal__create-btn"
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

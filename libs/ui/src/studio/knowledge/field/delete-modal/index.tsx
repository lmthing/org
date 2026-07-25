import * as Prim from '../../../../elements/primitives/index';
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { X, AlertTriangle } from 'lucide-react'
import { DIALOG_BACKDROP, DIALOG_BASE, DIALOG_CONTENT, DIALOG_HEADER } from '../../../../elements/overlays/dialog/index'
import { DELETE_MODAL_CLOSE_ICON, DELETE_MODAL_NOTE, DELETE_MODAL_TITLE, DELETE_MODAL_WARNING_ICON } from '../../props'

interface DeleteModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  nodePath: string
  isDirectory: boolean
}

export function DeleteModal({ isOpen, onClose, onConfirm, nodePath, isDirectory }: DeleteModalProps) {
  if (!isOpen) return null

  const name = nodePath.split('/').pop() || nodePath

  return (
    <Prim.Box {...DIALOG_BACKDROP} onClick={onClose}>
      <Prim.Box
        {...DIALOG_BASE}
        maxWidth={384}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      >
        <Prim.Box {...DIALOG_HEADER} borderBottomWidth={2} borderBottomColor="$destructive">
          <Prim.Box display="flex" alignItems="center" gap="$2">
            <AlertTriangle {...DELETE_MODAL_WARNING_ICON} />
            <Heading level={3} {...DELETE_MODAL_TITLE}>Delete {isDirectory ? 'Folder' : 'File'}</Heading>
          </Prim.Box>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X {...DELETE_MODAL_CLOSE_ICON} />
          </Button>
        </Prim.Box>

        <Prim.Box {...DIALOG_CONTENT}>
          <Prim.Box paddingVertical={0} paddingHorizontal="$6">
            <Caption>
              Are you sure you want to delete <Prim.Text as="strong">{name}</Prim.Text>?
            </Caption>
            {isDirectory && (
              <Caption muted {...DELETE_MODAL_NOTE}>
                This will permanently delete this folder and all of its contents. This action cannot be undone.
              </Caption>
            )}
            {!isDirectory && (
              <Caption muted {...DELETE_MODAL_NOTE}>
                This action cannot be undone.
              </Caption>
            )}
          </Prim.Box>

          <Prim.Box display="flex" justifyContent="flex-end" gap="$3" paddingVertical="$4" paddingHorizontal="$6" borderTopWidth={1} borderTopColor="$border" marginTop="$4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" onClick={onConfirm}>Delete</Button>
          </Prim.Box>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

import * as Prim from '../../../../elements/primitives/index.js';
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { X, AlertTriangle } from 'lucide-react'
import '@lmthing/css/components/knowledge/index.css'
import { DIALOG_BACKDROP, DIALOG_BASE, DIALOG_CONTENT, DIALOG_HEADER } from '../../../../elements/overlays/dialog/index.js'

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
            <AlertTriangle className="delete-modal__warning-icon" />
            <Heading level={3} className="delete-modal__title">Delete {isDirectory ? 'Folder' : 'File'}</Heading>
          </Prim.Box>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="delete-modal__close-icon" />
          </Button>
        </Prim.Box>

        <Prim.Box {...DIALOG_CONTENT}>
          <Prim.Box paddingVertical={0} paddingHorizontal="$6">
            <Caption>
              Are you sure you want to delete <Prim.Text as="strong">{name}</Prim.Text>?
            </Caption>
            {isDirectory && (
              <Caption muted className="delete-modal__note">
                This will permanently delete this folder and all of its contents. This action cannot be undone.
              </Caption>
            )}
            {!isDirectory && (
              <Caption muted className="delete-modal__note">
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

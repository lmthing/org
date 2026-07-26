import * as Prim from '../../../../elements/primitives/index';
import { Heading } from '../../../../elements/typography/heading'
import { Caption } from '../../../../elements/typography/caption'
import { Button } from '../../../../elements/forms/button'
import { X, AlertTriangle } from 'lucide-react'
import { DIALOG_BACKDROP, DIALOG_BASE, DIALOG_CONTENT, DIALOG_HEADER } from '../../../../elements/overlays/dialog/index'
import { UNSAVED_MODAL_CLOSE_ICON, UNSAVED_MODAL_WARNING_ICON } from '../../props'

interface UnsavedChangesModalProps {
  isOpen: boolean
  onDiscard: () => void
  onCancel: () => void
  onSave: () => void
}

export function UnsavedChangesModal({ isOpen, onDiscard, onCancel, onSave }: UnsavedChangesModalProps) {
  if (!isOpen) return null

  return (
    <Prim.Box {...DIALOG_BACKDROP} onClick={onCancel}>
      <Prim.Box
        {...DIALOG_BASE}
        maxWidth={384}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
      >
        <Prim.Box {...DIALOG_HEADER}>
          <Prim.Box display="flex" alignItems="center" gap="$2">
            <AlertTriangle {...UNSAVED_MODAL_WARNING_ICON} />
            <Heading level={3}>Unsaved Changes</Heading>
          </Prim.Box>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X {...UNSAVED_MODAL_CLOSE_ICON} />
          </Button>
        </Prim.Box>

        <Prim.Box {...DIALOG_CONTENT}>
          <Prim.Box paddingVertical={0} paddingHorizontal="$6">
            <Caption muted>
              You have unsaved changes. Do you want to save them before switching files?
            </Caption>
          </Prim.Box>

          <Prim.Box display="flex" justifyContent="flex-end" gap="$3" paddingVertical="$4" paddingHorizontal="$6" borderTopWidth={1} borderTopColor="$border" marginTop="$4">
            <Button variant="destructive" onClick={onDiscard}>Discard</Button>
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" onClick={onSave}>Save</Button>
          </Prim.Box>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

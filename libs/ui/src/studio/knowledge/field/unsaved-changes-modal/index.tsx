import * as Prim from '../../../../elements/primitives/index.js';
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { X, AlertTriangle } from 'lucide-react'
import '@lmthing/css/components/knowledge/index.css'

interface UnsavedChangesModalProps {
  isOpen: boolean
  onDiscard: () => void
  onCancel: () => void
  onSave: () => void
}

export function UnsavedChangesModal({ isOpen, onDiscard, onCancel, onSave }: UnsavedChangesModalProps) {
  if (!isOpen) return null

  return (
    <Prim.Box className="dialog__backdrop" onClick={onCancel}>
      <Prim.Box
        className="dialog"
        maxWidth={384}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
      >
        <Prim.Box className="dialog__header">
          <Prim.Box display="flex" alignItems="center" gap="$2">
            <AlertTriangle className="unsaved-modal__warning-icon" />
            <Heading level={3}>Unsaved Changes</Heading>
          </Prim.Box>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="unsaved-modal__close-icon" />
          </Button>
        </Prim.Box>

        <Prim.Box className="dialog__content">
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

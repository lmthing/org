import * as Prim from '../../../../elements/primitives/index.js';
import { useEffect, useCallback, useRef } from 'react'
import { useUIState } from '@lmthing/state'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { X } from 'lucide-react'
import { DIALOG_BACKDROP, DIALOG_BASE, DIALOG_CONTENT, DIALOG_HEADER } from '../../../../elements/overlays/dialog/index.js'
import { RENAME_MODAL_CLOSE_ICON, RENAME_MODAL_ERROR } from '../../props.js'

interface RenameModalProps {
  isOpen: boolean
  onClose: () => void
  onRename: (newName: string) => void
  currentName: string
  isDirectory: boolean
}

export function RenameModal({ isOpen, onClose, onRename, currentName, isDirectory }: RenameModalProps) {
  const [name, setName] = useUIState<string>('rename-modal.name', currentName)
  const [error, setError] = useUIState<string>('rename-modal.error', '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName(currentName)
      setError('')
      // Auto-select name portion (not extension) after mount
      requestAnimationFrame(() => {
        if (inputRef.current) {
          const dotIndex = currentName.lastIndexOf('.')
          if (dotIndex > 0 && !isDirectory) {
            inputRef.current.setSelectionRange(0, dotIndex)
          } else {
            inputRef.current.select()
          }
        }
      })
    }
  }, [isOpen, currentName, isDirectory])

  const validate = useCallback((value: string): string => {
    if (!value.trim()) return 'Name cannot be empty'
    if (value.includes('/') || value.includes('\\')) return 'Name cannot contain / or \\'
    return ''
  }, [])

  const handleSubmit = useCallback(() => {
    const err = validate(name)
    if (err) {
      setError(err)
      return
    }
    if (name !== currentName) {
      onRename(name.trim())
    }
    onClose()
  }, [name, currentName, validate, onRename, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') onClose()
  }, [handleSubmit, onClose])

  if (!isOpen) return null

  return (
    <Prim.Box {...DIALOG_BACKDROP} onClick={onClose}>
      <Prim.Box
        {...DIALOG_BASE}
        maxWidth={384}
        onClick={e => e.stopPropagation()}
      >
        <Prim.Box {...DIALOG_HEADER}>
          <Heading level={3}>Rename {isDirectory ? 'Folder' : 'File'}</Heading>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X {...RENAME_MODAL_CLOSE_ICON} />
          </Button>
        </Prim.Box>

        <Prim.Box {...DIALOG_CONTENT}>
          <Prim.Box paddingVertical={0} paddingHorizontal="$6">
            <Label>New name</Label>
            <Input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              onKeyDown={handleKeyDown}
              error={!!error}
              autoFocus
            />
            {error && (
              <Caption {...RENAME_MODAL_ERROR}>
                {error}
              </Caption>
            )}
          </Prim.Box>

          <Prim.Box display="flex" justifyContent="flex-end" gap="$3" paddingVertical="$4" paddingHorizontal="$6" borderTopWidth={1} borderTopColor="$border" marginTop="$4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSubmit} disabled={!name.trim()}>Rename</Button>
          </Prim.Box>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

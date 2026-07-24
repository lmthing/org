/**
 * ComponentListItem — a single row in the view/form component list, with
 * inline rename and delete controls.
 */
import * as Prim from '../../elements/primitives/index.js';
import { useCallback, useEffect, useRef } from 'react'
import { useUIState } from '@lmthing/state'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import type { ComponentKind } from './component-editor-utils'

interface ComponentListItemProps {
  name: string
  kind: ComponentKind
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newName: string) => void
}

export function ComponentListItem({ name, kind, isActive, onSelect, onDelete, onRename }: ComponentListItemProps) {
  const stateKey = `comp-item.${kind}.${name}`
  const [renaming, setRenaming] = useUIState(`${stateKey}.renaming`, false)
  const [renameValue, setRenameValue] = useUIState(`${stateKey}.rename-value`, name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) {
      setRenameValue(name)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [renaming, name, setRenameValue])

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim().replace(/\.tsx$/, '')
    if (trimmed && trimmed !== name) onRename(trimmed)
    setRenaming(false)
  }, [renameValue, name, onRename, setRenaming])

  return (
    <Prim.Box
      className={`component-editor__list-item${isActive ? ' component-editor__list-item--active' : ''}`}
      onClick={() => { if (!renaming) onSelect() }}
    >
      {renaming ? (
        <Input
          ref={inputRef}
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename() }
            if (e.key === 'Escape') setRenaming(false)
          }}
          onBlur={commitRename}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1 }}
        />
      ) : (
        <Prim.Text fontFamily="monospace" fontSize="$sm">{name}.tsx</Prim.Text>
      )}

      <Prim.Box className="component-editor__list-item-actions" onClick={e => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          title="Rename"
          onClick={() => setRenaming(true)}
        >
          ✎
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Delete"
          onClick={onDelete}
        >
          ✕
        </Button>
      </Prim.Box>
    </Prim.Box>
  )
}

/**
 * ComponentListItem — a single row in the view/form component list, with
 * inline rename and delete controls.
 */
import * as Prim from '../../elements/primitives/index';
import { useCallback, useEffect, useRef } from 'react'
import { useUIState } from '@lmthing/state'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import type { ComponentKind } from './component-editor-utils'

/**
 * The former `.component-editor__list-item*` rules, hand-migrated: the sweep cannot take them
 * because the block mixes a dynamic `--active` modifier with a `:hover .child` descendant
 * combinator. The combinator becomes a Tamagui hover GROUP (`group="row"` + `$group-row-hover`),
 * the same shape proven on `elements/nav/app-sidebar`. `transition:` has no prop form and stays a
 * utility className alongside the other 130-odd `transition-*` uses.
 * See docs/tamagui-idiomatic-migration.md §5.
 */
const LIST_ITEM = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingVertical: '$1.5',
  paddingHorizontal: '$2',
  borderRadius: '$radius-md',
  cursor: 'pointer',
  hoverStyle: { backgroundColor: 'var(--color-surface-hover, rgba(0,0,0,0.04))' }, // ds-lint-ok: fallback alpha-black
} as const
const LIST_ITEM_ACTIVE = { backgroundColor: 'var(--color-surface-active, rgba(0,0,0,0.07))' } as const // ds-lint-ok: fallback alpha-black
const LIST_ITEM_ACTIONS = {
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  opacity: 0,
  '$group-row-hover': { opacity: 1 },
} as const

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
      transition="quick" animateOnly={["color", "background-color", "border-color"]}
      {...LIST_ITEM}
      {...(isActive ? LIST_ITEM_ACTIVE : null)}
      {...({ group: 'row' } as Record<string, unknown>)}
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
          flexGrow={1} flexShrink={1} flexBasis={0}
        />
      ) : (
        <Prim.Text fontFamily="monospace" fontSize="$sm">{name}.tsx</Prim.Text>
      )}

      <Prim.Box transition="quick" animateOnly={["opacity"]} {...LIST_ITEM_ACTIONS} onClick={e => e.stopPropagation()}>
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

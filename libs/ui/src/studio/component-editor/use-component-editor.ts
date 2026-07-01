/**
 * useComponentEditor — state + effects backing the ComponentEditor
 * composition: view/form listing, selection, the inline "new component"
 * form, and create/delete/rename handlers against the active SpaceFS.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useSpaceFS, useGlob, useUIState, P } from '@lmthing/state'
import {
  type ComponentKind,
  VIEW_TEMPLATE,
  FORM_TEMPLATE,
  componentNameFromPath,
  pathForComponent,
} from './component-editor-utils'

export interface UseComponentEditorOptions {
  /** Optional callback fired after a file is created/deleted/renamed */
  onChanged?: () => void
}

export function useComponentEditor({ onChanged }: UseComponentEditorOptions) {
  const spaceFS = useSpaceFS()
  const viewMatches = useGlob(P.globs.allViewComponents)
  const formMatches = useGlob(P.globs.allFormComponents)

  const viewNames = viewMatches.map(componentNameFromPath).filter(Boolean).sort()
  const formNames = formMatches.map(componentNameFromPath).filter(Boolean).sort()

  const [selectedKind, setSelectedKind] = useUIState<ComponentKind>('component-editor.selected-kind', 'view')
  const [selectedName, setSelectedName] = useUIState<string | null>('component-editor.selected-name', null)

  const [showNewForm, setShowNewForm] = useUIState<boolean>('component-editor.show-new', false)
  const [newName, setNewName] = useUIState<string>('component-editor.new-name', '')
  const [newKind, setNewKind] = useUIState<ComponentKind>('component-editor.new-kind', 'view')
  const newInputRef = useRef<HTMLInputElement>(null)

  // Auto-select first available item
  useEffect(() => {
    const names = selectedKind === 'view' ? viewNames : formNames
    if (selectedName && names.includes(selectedName)) return
    const fallback = viewNames[0] ? ['view', viewNames[0]] as const : formNames[0] ? ['form', formNames[0]] as const : null
    if (fallback) {
      setSelectedKind(fallback[0])
      setSelectedName(fallback[1])
    } else {
      setSelectedName(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewNames.join(','), formNames.join(','), selectedKind, selectedName])

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim().replace(/\.tsx$/, '')
    if (!trimmed || !spaceFS) return
    const path = pathForComponent(newKind, trimmed)
    const template = newKind === 'view' ? VIEW_TEMPLATE(trimmed) : FORM_TEMPLATE(trimmed)
    spaceFS.writeFile(path, template)
    setSelectedKind(newKind)
    setSelectedName(trimmed)
    setNewName('')
    setShowNewForm(false)
    onChanged?.()
  }, [newName, newKind, spaceFS, onChanged, setSelectedKind, setSelectedName, setNewName, setShowNewForm])

  const handleDelete = useCallback((kind: ComponentKind, name: string) => {
    if (!spaceFS) return
    spaceFS.deleteFile(pathForComponent(kind, name))
    if (selectedKind === kind && selectedName === name) {
      const remaining = (kind === 'view' ? viewNames : formNames).filter(n => n !== name)
      setSelectedName(remaining[0] ?? null)
    }
    onChanged?.()
  }, [spaceFS, selectedKind, selectedName, viewNames, formNames, setSelectedName, onChanged])

  const handleRename = useCallback((kind: ComponentKind, oldName: string, newNameValue: string) => {
    if (!spaceFS) return
    const oldPath = pathForComponent(kind, oldName)
    const newPath = pathForComponent(kind, newNameValue)
    const existing = spaceFS.readFile(oldPath) ?? ''
    // Update the default-export identifier in the template if possible
    const updated = existing.replace(
      new RegExp(`export default function ${oldName}`, 'g'),
      `export default function ${newNameValue}`
    )
    spaceFS.writeFile(newPath, updated)
    spaceFS.deleteFile(oldPath)
    if (selectedKind === kind && selectedName === oldName) setSelectedName(newNameValue)
    onChanged?.()
  }, [spaceFS, selectedKind, selectedName, setSelectedName, onChanged])

  const selectedPath = selectedName ? pathForComponent(selectedKind, selectedName) : null

  return {
    viewNames,
    formNames,
    selectedKind,
    setSelectedKind,
    selectedName,
    setSelectedName,
    showNewForm,
    setShowNewForm,
    newName,
    setNewName,
    newKind,
    setNewKind,
    newInputRef,
    handleCreate,
    handleDelete,
    handleRename,
    selectedPath,
  }
}

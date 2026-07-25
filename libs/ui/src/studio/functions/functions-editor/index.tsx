/**
 * FunctionsEditor
 *
 * Reusable editor for the `functions/` directory of the active space.
 * Displays a list of `functions/<name>.ts` files discovered via the VFS,
 * and lets the user create, rename, delete, and edit their raw TypeScript
 * source in a code textarea — matching the same draft/save pattern used by
 * the agent-builder and topic-editor.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { useCallback, useEffect, useRef } from 'react'
import { useSpaceFS, useGlob, useFile, useUIState, P } from '@lmthing/state'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { INPUT_BASE } from '../../../elements/forms/input/index.js'
import { FUNCTIONS_EDITOR_TEXTAREA } from '../props.js'

// ── helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_FUNCTION_TEMPLATE = `/**
 * Describe what this function does.
 */
export default function untitled(): void {
  // implementation
}
`

function functionNameFromPath(path: string): string {
  return path.split('/').pop()?.replace(/\.ts$/, '') ?? path
}

/**
 * Does a function's source opt into host-enforced consent? True when a LEADING
 * comment (JSDoc block or `//` line, before any code) carries the `@consent`
 * pragma. Browser-safe mirror of core's `functionRequiresConsent`
 * (`globals/consent.ts`) — that module pulls in `node:crypto`, so we can't import
 * it into the web bundle. Keep the two in sync.
 */
function functionRequiresConsent(source: string): boolean {
  let i = 0
  const n = source.length
  while (i < n) {
    while (i < n && /\s/.test(source[i]!)) i++
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i)
      const line = end === -1 ? source.slice(i) : source.slice(i, end)
      if (/@consent\b/.test(line)) return true
      i = end === -1 ? n : end + 1
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i)
      const block = end === -1 ? source.slice(i) : source.slice(i, end)
      if (/@consent\b/.test(block)) return true
      i = end === -1 ? n : end + 2
    } else {
      break
    }
  }
  return false
}

// ── FunctionListItem ──────────────────────────────────────────────────────────

/**
 * The former `.functions-editor__list-item*` rules, hand-migrated (twin of
 * `studio/component-editor/component-list-item.tsx`): the sweep cannot take them because the block
 * mixes a dynamic `--active` modifier with a `:hover .child` descendant combinator. The combinator
 * becomes a Tamagui hover GROUP (`group="row"` + `$group-row-hover`), the same shape proven on
 * `elements/nav/app-sidebar`. `transition:` has no prop form and stays a utility className
 * alongside the other 130-odd `transition-*` uses. See docs/tamagui-idiomatic-migration.md §5.
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

interface FunctionListItemProps {
  name: string
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newName: string) => void
}

function FunctionListItem({ name, isActive, onSelect, onDelete, onRename }: FunctionListItemProps) {
  const [renaming, setRenaming] = useUIState(`fn-item.${name}.renaming`, false)
  const [renameValue, setRenameValue] = useUIState(`fn-item.${name}.rename-value`, name)
  const inputRef = useRef<HTMLInputElement>(null)
  const source = useFile(P.functionFile(name))
  const requiresConsent = typeof source === 'string' && functionRequiresConsent(source)

  useEffect(() => {
    if (renaming) {
      setRenameValue(name)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [renaming, name, setRenameValue])

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim().replace(/\.ts$/, '')
    if (trimmed && trimmed !== name) onRename(trimmed)
    setRenaming(false)
  }, [renameValue, name, onRename, setRenaming])

  return (
    <Prim.Box
      className="transition-colors"
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
          style={{ flex: 1 }}
        />
      ) : (
        <Prim.Text fontFamily="monospace" fontSize="$sm">
          {name}.ts
          {requiresConsent && (
            <Badge variant="primary" title="Runs only after the user approves a consent card (@consent)" style={{ marginLeft: 6 }}>
              consent
            </Badge>
          )}
        </Prim.Text>
      )}

      <Prim.Box className="transition-opacity" {...LIST_ITEM_ACTIONS} onClick={e => e.stopPropagation()}>
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

// ── FunctionCodeEditor ────────────────────────────────────────────────────────

interface FunctionCodeEditorProps {
  functionPath: string
}

function FunctionCodeEditor({ functionPath }: FunctionCodeEditorProps) {
  const spaceFS = useSpaceFS()
  const rawContent = useFile(functionPath)
  const name = functionNameFromPath(functionPath)

  const [draft, setDraft] = useUIState<string>(`fn-editor.${functionPath}.draft`, '')
  const [hasUnsaved, setHasUnsaved] = useUIState<boolean>(`fn-editor.${functionPath}.unsaved`, false)

  // Sync draft when file content changes (load / external update)
  const syncKey = `${functionPath}::${rawContent ?? ''}`
  const lastSyncKey = useRef('')
  useEffect(() => {
    if (lastSyncKey.current === syncKey) return
    lastSyncKey.current = syncKey
    if (rawContent !== null && rawContent !== undefined) {
      setDraft(rawContent)
      setHasUnsaved(false)
    }
  })

  const handleChange = useCallback((value: string) => {
    setDraft(value)
    setHasUnsaved(true)
  }, [setDraft, setHasUnsaved])

  const handleSave = useCallback(() => {
    if (!spaceFS || !hasUnsaved) return
    spaceFS.writeFile(functionPath, draft)
    setHasUnsaved(false)
  }, [spaceFS, functionPath, draft, hasUnsaved, setHasUnsaved])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  return (
    <Prim.Box display="flex" flexDirection="column" flexGrow={1} flexShrink={1} flexBasis="0%" gap="$2">
      <Prim.Box display="flex" alignItems="center" justifyContent="space-between">
        <Stack row gap="sm">
          <Label>{name}.ts</Label>
          <Caption muted>{functionPath}</Caption>
        </Stack>
        <Stack row gap="sm">
          {hasUnsaved && <Caption muted>Unsaved</Caption>}
          <Button
            variant="primary"
            size="sm"
            disabled={!hasUnsaved}
            onClick={handleSave}
          >
            Save
          </Button>
        </Stack>
      </Prim.Box>

      <Prim.TextArea
        {...INPUT_BASE} {...FUNCTIONS_EDITOR_TEXTAREA}
        value={draft}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        placeholder="// Write TypeScript source here…"
      />
    </Prim.Box>
  )
}

// ── FunctionsEditor ───────────────────────────────────────────────────────────

export interface FunctionsEditorProps {
  /** Optional callback fired after a file is created/deleted/renamed */
  onChanged?: () => void
}

/**
 * Editor for the `functions/` directory of the active space.
 * Lists all `functions/<name>.ts` files, allows create / rename / delete,
 * and lets the user edit their raw TypeScript source in-place.
 *
 * Relies on the active SpaceFS context (SpaceProvider must be a parent).
 */
export function FunctionsEditor({ onChanged }: FunctionsEditorProps) {
  const spaceFS = useSpaceFS()
  const functionMatches = useGlob(P.globs.allFunctions)

  const functionNames = functionMatches
    .map(p => functionNameFromPath(p))
    .filter(Boolean)
    .sort()

  const [selectedName, setSelectedName] = useUIState<string | null>('functions-editor.selected', null)
  const [showNewForm, setShowNewForm] = useUIState<boolean>('functions-editor.show-new', false)
  const [newName, setNewName] = useUIState<string>('functions-editor.new-name', '')
  const newInputRef = useRef<HTMLInputElement>(null)

  // Auto-select first available item when selection is cleared
  useEffect(() => {
    if (selectedName && functionNames.includes(selectedName)) return
    setSelectedName(functionNames[0] ?? null)
  }, [functionNames, selectedName, setSelectedName])

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim().replace(/\.ts$/, '')
    if (!trimmed || !spaceFS) return
    const path = P.functionFile(trimmed)
    const template = DEFAULT_FUNCTION_TEMPLATE.replace('untitled', trimmed)
    spaceFS.writeFile(path, template)
    setSelectedName(trimmed)
    setNewName('')
    setShowNewForm(false)
    onChanged?.()
  }, [newName, spaceFS, onChanged, setSelectedName, setNewName, setShowNewForm])

  const handleDelete = useCallback((name: string) => {
    if (!spaceFS) return
    spaceFS.deleteFile(P.functionFile(name))
    if (selectedName === name) {
      const remaining = functionNames.filter(n => n !== name)
      setSelectedName(remaining[0] ?? null)
    }
    onChanged?.()
  }, [spaceFS, selectedName, functionNames, setSelectedName, onChanged])

  const handleRename = useCallback((oldName: string, newNameValue: string) => {
    if (!spaceFS) return
    const oldPath = P.functionFile(oldName)
    const newPath = P.functionFile(newNameValue)
    const existing = spaceFS.readFile(oldPath) ?? ''
    spaceFS.writeFile(newPath, existing)
    spaceFS.deleteFile(oldPath)
    if (selectedName === oldName) setSelectedName(newNameValue)
    onChanged?.()
  }, [spaceFS, selectedName, setSelectedName, onChanged])

  const selectedPath = selectedName ? P.functionFile(selectedName) : null

  return (
    <Prim.Box display="flex" flexDirection="column" height="100%" gap="$4">
      {/* Header */}
      <Prim.Box display="flex" alignItems="center" justifyContent="space-between" paddingTop={0} paddingHorizontal={0} paddingBottom="$2" borderBottomWidth={1} borderBottomStyle="solid" borderBottomColor="$border">
        <Label>Functions ({functionNames.length})</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowNewForm(true)
            requestAnimationFrame(() => newInputRef.current?.focus())
          }}
        >
          + New function
        </Button>
      </Prim.Box>

      {/* New-function inline form */}
      {showNewForm && (
        <Prim.Box display="flex" alignItems="center" gap="$2" padding="$2" backgroundColor="var(--color-surface-subtle, rgba(0,0,0,0.02))" borderRadius="$radius-md" borderWidth={1} borderStyle="dashed" borderColor="$border">
          <Input
            ref={newInputRef}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleCreate() }
              if (e.key === 'Escape') { setShowNewForm(false); setNewName('') }
            }}
            placeholder="functionName"
            style={{ flex: 1 }}
          />
          <Caption muted>.ts</Caption>
          <Button size="sm" variant="primary" disabled={!newName.trim()} onClick={handleCreate}>
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowNewForm(false); setNewName('') }}>
            Cancel
          </Button>
        </Prim.Box>
      )}

      {/* File list */}
      <Prim.Box display="flex" flexDirection="column" gap="$1" minHeight="$8">
        {functionNames.length === 0 ? (
          <Prim.Box paddingVertical="$4" paddingHorizontal={0}>
            <Caption muted>No functions yet. Create one to get started.</Caption>
          </Prim.Box>
        ) : (
          functionNames.map(name => (
            <FunctionListItem
              key={name}
              name={name}
              isActive={selectedName === name}
              onSelect={() => setSelectedName(name)}
              onDelete={() => handleDelete(name)}
              onRename={newNameValue => handleRename(name, newNameValue)}
            />
          ))
        )}
      </Prim.Box>

      {/* Code editor pane */}
      {selectedPath && (
        <FunctionCodeEditor key={selectedPath} functionPath={selectedPath} />
      )}
    </Prim.Box>
  )
}

export default FunctionsEditor

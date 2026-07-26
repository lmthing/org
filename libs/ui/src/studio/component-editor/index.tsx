/**
 * ComponentEditor
 *
 * Reusable editor for the `components/` directory of the active space.
 * Manages both `components/view/<Name>.tsx` (display components, used with
 * `display()`) and `components/form/<Name>.tsx` (form components, used with
 * `ask()`). Each component is a single TSX file with a default export.
 *
 * Provides create / rename / delete / raw-source editing in a code textarea,
 * following the same draft/save pattern as the agent-builder and topic-editor.
 */
import * as Prim from '../../elements/primitives/index';
import { Stack } from '../../elements/layouts/stack'
import { Label } from '../../elements/typography/label'
import { Caption } from '../../elements/typography/caption'
import { Button } from '../../elements/forms/button'
import { Input } from '../../elements/forms/input'
import { Select, SelectOption } from '../../elements/forms/select'
import { ComponentListItem } from './component-list-item'
import { ComponentCodeEditor } from './component-code-editor'
import { useComponentEditor } from './use-component-editor'
import type { ComponentKind } from './component-editor-utils'

// ── ComponentEditor ───────────────────────────────────────────────────────────

export interface ComponentEditorProps {
  /** Optional callback fired after a file is created/deleted/renamed */
  onChanged?: () => void
}

/**
 * Editor for the `components/` directory of the active space.
 * Manages view components (`components/view/<Name>.tsx`) and form components
 * (`components/form/<Name>.tsx`). Provides create / rename / delete and
 * raw TSX source editing.
 *
 * View/form distinction is shown clearly in the UI via kind badges and
 * separate list sections. Relies on the active SpaceFS context (SpaceProvider
 * must be a parent).
 */
export function ComponentEditor({ onChanged }: ComponentEditorProps) {
  const {
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
  } = useComponentEditor({ onChanged })

  return (
    <Prim.Box display="flex" flexDirection="column" height="100%" gap="$4">
      {/* Header */}
      <Prim.Box display="flex" alignItems="center" justifyContent="space-between" paddingTop={0} paddingHorizontal={0} paddingBottom="$2" borderBottomWidth={1} borderBottomStyle="solid" borderBottomColor="$border">
        <Label>Components ({viewNames.length + formNames.length})</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowNewForm(true)
            requestAnimationFrame(() => newInputRef.current?.focus())
          }}
        >
          + New component
        </Button>
      </Prim.Box>

      {/* New-component inline form */}
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
            placeholder="ComponentName"
            flexGrow={1} flexShrink={1} flexBasis={0}
          />
          <Select
            value={newKind}
            onChange={e => setNewKind(e.target.value as ComponentKind)}
            width="6rem"
          >
            <SelectOption value="view">view</SelectOption>
            <SelectOption value="form">form</SelectOption>
          </Select>
          <Caption muted>.tsx</Caption>
          <Button size="sm" variant="primary" disabled={!newName.trim()} onClick={handleCreate}>
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowNewForm(false); setNewName('') }}>
            Cancel
          </Button>
        </Prim.Box>
      )}

      {/* View components section */}
      <Prim.Box>
        <Prim.Box display="flex" alignItems="center" gap="$2" marginBottom="$1.5">
          <Label compact>View</Label>
          <Prim.Text fontSize={11} paddingVertical="$0.5" paddingHorizontal="$1.5" borderRadius="$radius-full" fontWeight="$semibold" textTransform="uppercase" letterSpacing="0.04em" backgroundColor="color-mix(in srgb, var(--knowledge) 15%, transparent)" color="$knowledge">display()</Prim.Text>
        </Prim.Box>
        <Prim.Box display="flex" flexDirection="column" gap="$1" minHeight="$8">
          {viewNames.length === 0 ? (
            <Prim.Box paddingVertical="$3" paddingHorizontal={0}>
              <Caption muted>No view components yet.</Caption>
            </Prim.Box>
          ) : (
            viewNames.map(name => (
              <ComponentListItem
                key={`view:${name}`}
                name={name}
                kind="view"
                isActive={selectedKind === 'view' && selectedName === name}
                onSelect={() => { setSelectedKind('view'); setSelectedName(name) }}
                onDelete={() => handleDelete('view', name)}
                onRename={newNameValue => handleRename('view', name, newNameValue)}
              />
            ))
          )}
        </Prim.Box>
      </Prim.Box>

      {/* Form components section */}
      <Prim.Box>
        <Prim.Box display="flex" alignItems="center" gap="$2" marginBottom="$1.5">
          <Label compact>Form</Label>
          <Prim.Text fontSize={11} paddingVertical="$0.5" paddingHorizontal="$1.5" borderRadius="$radius-full" fontWeight="$semibold" textTransform="uppercase" letterSpacing="0.04em" backgroundColor="color-mix(in srgb, var(--success) 15%, transparent)" color="$success">ask()</Prim.Text>
        </Prim.Box>
        <Prim.Box display="flex" flexDirection="column" gap="$1" minHeight="$8">
          {formNames.length === 0 ? (
            <Prim.Box paddingVertical="$3" paddingHorizontal={0}>
              <Caption muted>No form components yet.</Caption>
            </Prim.Box>
          ) : (
            formNames.map(name => (
              <ComponentListItem
                key={`form:${name}`}
                name={name}
                kind="form"
                isActive={selectedKind === 'form' && selectedName === name}
                onSelect={() => { setSelectedKind('form'); setSelectedName(name) }}
                onDelete={() => handleDelete('form', name)}
                onRename={newNameValue => handleRename('form', name, newNameValue)}
              />
            ))
          )}
        </Prim.Box>
      </Prim.Box>

      {/* Code editor pane */}
      {selectedPath && (
        <ComponentCodeEditor
          key={selectedPath}
          componentPath={selectedPath}
          kind={selectedKind}
        />
      )}
    </Prim.Box>
  )
}

export default ComponentEditor

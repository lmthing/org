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
import '@lmthing/css/components/component-editor/index.css'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Select, SelectOption } from '@lmthing/ui/elements/forms/select'
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
    <div className="component-editor">
      {/* Header */}
      <div className="component-editor__header">
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
      </div>

      {/* New-component inline form */}
      {showNewForm && (
        <div className="component-editor__new-form">
          <Input
            ref={newInputRef}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleCreate() }
              if (e.key === 'Escape') { setShowNewForm(false); setNewName('') }
            }}
            placeholder="ComponentName"
            style={{ flex: 1 }}
          />
          <Select
            value={newKind}
            onChange={e => setNewKind(e.target.value as ComponentKind)}
            style={{ width: '6rem' }}
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
        </div>
      )}

      {/* View components section */}
      <div>
        <div className="component-editor__section-title">
          <Label compact>View</Label>
          <span className="component-editor__kind-badge component-editor__kind-badge--view">display()</span>
        </div>
        <div className="component-editor__list">
          {viewNames.length === 0 ? (
            <div className="component-editor__empty">
              <Caption muted>No view components yet.</Caption>
            </div>
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
        </div>
      </div>

      {/* Form components section */}
      <div>
        <div className="component-editor__section-title">
          <Label compact>Form</Label>
          <span className="component-editor__kind-badge component-editor__kind-badge--form">ask()</span>
        </div>
        <div className="component-editor__list">
          {formNames.length === 0 ? (
            <div className="component-editor__empty">
              <Caption muted>No form components yet.</Caption>
            </div>
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
        </div>
      </div>

      {/* Code editor pane */}
      {selectedPath && (
        <ComponentCodeEditor
          key={selectedPath}
          componentPath={selectedPath}
          kind={selectedKind}
        />
      )}
    </div>
  )
}

export default ComponentEditor

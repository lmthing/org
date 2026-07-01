import { Button } from '@lmthing/ui/elements/forms/button'
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { cn } from '@lmthing/ui/lib/utils'
import '@lmthing/css/components/workflow/step-schema-editor/index.css'
import { useSchemaModel, type JSONSchema } from './use-schema-model'
import { PropertyRow } from './property-row'

export type { JSONSchema }

interface StepSchemaEditorProps {
  value: JSONSchema | null
  onChange: (schema: JSONSchema | null) => void
}

export function StepSchemaEditor({ value, onChange }: StepSchemaEditorProps) {
  const {
    properties,
    viewMode,
    setViewMode,
    codeValue,
    handlePropertiesChange,
    handleSwitchToCode,
    handleCodeChange,
    handleAddProperty,
  } = useSchemaModel(value, onChange)

  return (
    <div className="schema-editor">
      {/* Header with mode toggle */}
      <div className="schema-editor__header">
        <Label compact>Schema Properties</Label>
        <div className="schema-editor__mode-toggle">
          <button
            onClick={() => setViewMode('visual')}
            className={cn(
              'schema-editor__mode-btn',
              viewMode === 'visual' && 'schema-editor__mode-btn--active'
            )}
          >
            Visual
          </button>
          <button
            onClick={handleSwitchToCode}
            className={cn(
              'schema-editor__mode-btn',
              viewMode === 'code' && 'schema-editor__mode-btn--active'
            )}
          >
            Code
          </button>
        </div>
      </div>

      {/* Visual editor */}
      {viewMode === 'visual' && (
        <div className="schema-editor__body">
          {properties.length === 0 ? (
            <div className="schema-editor__empty">
              <div className="schema-editor__empty-icon-wrapper">
                <svg className="schema-editor__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18V5l12 7-12 7z" />
                </svg>
              </div>
              <Caption muted className="schema-editor__empty-caption">No properties defined yet</Caption>
              <Button variant="primary" onClick={handleAddProperty}>
                <svg className="schema-editor__add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Property
              </Button>
            </div>
          ) : (
            <div className="schema-editor__property-list">
              {properties.map((property, index) => (
                <PropertyRow
                  key={property.id}
                  property={property}
                  index={index}
                  onUpdate={(updated) => {
                    const newProperties = [...properties]
                    newProperties[index] = updated
                    handlePropertiesChange(newProperties)
                  }}
                  onDelete={() => {
                    handlePropertiesChange(properties.filter((_, i) => i !== index))
                  }}
                  onToggleRequired={() => {
                    const newProperties = [...properties]
                    newProperties[index] = { ...property, required: !property.required }
                    handlePropertiesChange(newProperties)
                  }}
                  isFirst={index === 0}
                  isLast={index === properties.length - 1}
                  onMoveUp={() => {
                    if (index > 0) {
                      const newProperties = [...properties]
                      ;[newProperties[index - 1], newProperties[index]] = [newProperties[index], newProperties[index - 1]]
                      handlePropertiesChange(newProperties)
                    }
                  }}
                  onMoveDown={() => {
                    if (index < properties.length - 1) {
                      const newProperties = [...properties]
                      ;[newProperties[index], newProperties[index + 1]] = [newProperties[index + 1], newProperties[index]]
                      handlePropertiesChange(newProperties)
                    }
                  }}
                />
              ))}
              <button
                onClick={handleAddProperty}
                className="schema-editor__add-btn"
              >
                <svg className="schema-editor__add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Property
              </button>
            </div>
          )}
        </div>
      )}

      {/* Code editor */}
      {viewMode === 'code' && (
        <div className="schema-editor__body">
          <Textarea
            value={codeValue}
            onChange={(e) => handleCodeChange(e.target.value)}
            className="schema-editor__code-textarea"
            placeholder='{\n  "type": "object",\n  "properties": {\n    "example": { "type": "string" }\n  }\n}'
          />
          {(() => {
            try {
              JSON.parse(codeValue)
              return null
            } catch {
              return (
                <Caption muted className="schema-editor__code-error">
                  Invalid JSON schema
                </Caption>
              )
            }
          })()}
        </div>
      )}
    </div>
  )
}

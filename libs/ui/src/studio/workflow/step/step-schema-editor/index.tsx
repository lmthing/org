import * as Prim from '../../../../elements/primitives/index.js';
import { Button } from '@lmthing/ui/elements/forms/button'
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { useSchemaModel, type JSONSchema } from './use-schema-model'
import { PropertyRow } from './property-row'
import { SCHEMA_EDITOR_ADD_ICON, SCHEMA_EDITOR_CODE_ERROR, SCHEMA_EDITOR_CODE_TEXTAREA, SCHEMA_EDITOR_EMPTY_CAPTION, SCHEMA_EDITOR_EMPTY_ICON } from '../../step-schema-editor.props.js'

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
    <Prim.Box backgroundColor="$muted" borderRadius="0.75rem" overflow="hidden">
      {/* Header with mode toggle */}
      <Prim.Box display="flex" alignItems="center" justifyContent="space-between" paddingVertical="$2" paddingHorizontal="$4" borderBottomWidth={1} borderBottomColor="$border">
        <Label compact>Schema Properties</Label>
        <Prim.Box display="flex" alignItems="center" gap="$1" backgroundColor="$muted" borderRadius="0.5rem" padding="$1">
          <Prim.Pressable
            onClick={() => setViewMode('visual')}
            fontSize="$sm"
            fontWeight="$medium"
            paddingVertical="$1"
            paddingHorizontal="$3"
            borderRadius="0.375rem"
            color="$muted-foreground"
            // transition-all awaits the animation driver (§5/P4)
            hoverStyle={{ color: '$foreground' }}
            {...(viewMode === 'visual'
              ? {
                  backgroundColor: '$card',
                  color: '$foreground',
                  shadowColor: 'rgba(0,0,0,0.05)',
                  shadowOffset: { width: 0, height: 1 },
                  shadowRadius: 2,
                }
              : {})}
          >
            Visual
          </Prim.Pressable>
          <Prim.Pressable
            onClick={handleSwitchToCode}
            fontSize="$sm"
            fontWeight="$medium"
            paddingVertical="$1"
            paddingHorizontal="$3"
            borderRadius="0.375rem"
            color="$muted-foreground"
            // transition-all awaits the animation driver (§5/P4)
            hoverStyle={{ color: '$foreground' }}
            {...(viewMode === 'code'
              ? {
                  backgroundColor: '$card',
                  color: '$foreground',
                  shadowColor: 'rgba(0,0,0,0.05)',
                  shadowOffset: { width: 0, height: 1 },
                  shadowRadius: 2,
                }
              : {})}
          >
            Code
          </Prim.Pressable>
        </Prim.Box>
      </Prim.Box>

      {/* Visual editor */}
      {viewMode === 'visual' && (
        <Prim.Box padding="$3">
          {properties.length === 0 ? (
            <Prim.Box textAlign="center" paddingVertical="$8" paddingHorizontal={0}>
              <Prim.Box
                width="$12"
                height="$12"
                borderRadius="$radius-full"
                display="flex"
                alignItems="center"
                justifyContent="center"
                marginHorizontal="auto"
                backgroundColor="$muted"
                marginBottom="$3"
              >
                <Prim.Svg {...SCHEMA_EDITOR_EMPTY_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <Prim.Path d="M9 18V5l12 7-12 7z" />
                </Prim.Svg>
              </Prim.Box>
              <Caption muted {...SCHEMA_EDITOR_EMPTY_CAPTION}>No properties defined yet</Caption>
              <Button variant="primary" onClick={handleAddProperty}>
                <Prim.Svg {...SCHEMA_EDITOR_ADD_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <Prim.Path d="M12 5v14M5 12h14" />
                </Prim.Svg>
                Add Property
              </Button>
            </Prim.Box>
          ) : (
            <Prim.Box display="flex" flexDirection="column" gap="$2">
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
              <Prim.Pressable
                onClick={handleAddProperty}
                width="100%"
                fontSize="$sm"
                display="flex"
                alignItems="center"
                justifyContent="center"
                gap="$2"
                padding="$3"
                borderRadius="0.75rem"
                borderWidth={2}
                borderStyle="dashed"
                borderColor="$border"
                color="$muted-foreground"
                // transition-colors awaits the animation driver (§5/P4)
                hoverStyle={{ borderColor: '$brand-3', color: '$brand-3' }}
              >
                <Prim.Svg {...SCHEMA_EDITOR_ADD_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <Prim.Path d="M12 5v14M5 12h14" />
                </Prim.Svg>
                Add Property
              </Prim.Pressable>
            </Prim.Box>
          )}
        </Prim.Box>
      )}

      {/* Code editor */}
      {viewMode === 'code' && (
        <Prim.Box padding="$3">
          <Textarea
            value={codeValue}
            onChange={(e) => handleCodeChange(e.target.value)}
            {...SCHEMA_EDITOR_CODE_TEXTAREA}
            placeholder='{\n  "type": "object",\n  "properties": {\n    "example": { "type": "string" }\n  }\n}'
          />
          {(() => {
            try {
              JSON.parse(codeValue)
              return null
            } catch {
              return (
                <Caption muted {...SCHEMA_EDITOR_CODE_ERROR}>
                  Invalid JSON schema
                </Caption>
              )
            }
          })()}
        </Prim.Box>
      )}
    </Prim.Box>
  )
}

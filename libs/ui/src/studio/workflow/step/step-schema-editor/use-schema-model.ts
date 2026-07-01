import { useEffect } from 'react'
import { useUIState } from '@lmthing/state'

// JSONSchema — local definition (no dependency on old flow-builder types)
export interface JSONSchema {
  type?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  enum?: string[]
  format?: string
  minimum?: number
  maximum?: number
  [key: string]: unknown
}

export type PropertyType = 'string' | 'number' | 'boolean' | 'object' | 'array'

export interface Property {
  id?: string
  name: string
  type: PropertyType
  required: boolean
  description?: string
  format?: string
  enum?: string[]
  minimum?: number
  maximum?: number
  properties?: Record<string, Omit<Property, 'name' | 'required' | 'id'>>
  items?: Omit<Property, 'name' | 'id' | 'required'>
}

function propertiesToJsonSchema(properties: Property[], _required: string[]): JSONSchema {
  const schema: JSONSchema = { type: 'object' }

  if (properties.length > 0) {
    schema.properties = {}
    const requiredFields: string[] = []

    for (const prop of properties) {
      const propSchema: JSONSchema = { type: prop.type }

      if (prop.type === 'string') {
        if (prop.format) propSchema.format = prop.format
        if (prop.enum && prop.enum.length > 0) propSchema.enum = prop.enum
      }

      if (prop.type === 'number') {
        if (prop.minimum !== undefined) propSchema.minimum = prop.minimum
        if (prop.maximum !== undefined) propSchema.maximum = prop.maximum
      }

      if (prop.type === 'object' && prop.properties) {
        const nestedProps = Object.entries(prop.properties).map(([name, p]) => ({
          id: generateId(),
          name,
          ...p,
          required: false,
        }))
        propSchema.properties = propertiesToJsonSchema(nestedProps, []).properties
      }

      if (prop.type === 'array' && prop.items) {
        propSchema.items = {
          type: prop.items.type,
          ...(prop.items.format && { format: prop.items.format }),
          ...(prop.items.enum && { enum: prop.items.enum }),
          ...(prop.items.minimum !== undefined && { minimum: prop.items.minimum }),
          ...(prop.items.maximum !== undefined && { maximum: prop.items.maximum }),
        } as JSONSchema
      }

      schema.properties[prop.name] = propSchema

      if (prop.required) {
        requiredFields.push(prop.name)
      }
    }

    if (requiredFields.length > 0) {
      schema.required = requiredFields
    }
  }

  return schema
}

let idCounter = 0
export const generateId = () => `prop_${++idCounter}_${Date.now()}`

function jsonSchemaToProperties(schema: JSONSchema | null): Property[] {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return []
  }

  const requiredFields = schema.required || []

  return Object.entries(schema.properties).map(([name, propSchema]) => {
    const property: Property = {
      id: generateId(),
      name,
      type: (propSchema.type as PropertyType) || 'string',
      required: requiredFields.includes(name),
    }

    if (propSchema.format) property.format = propSchema.format
    if (propSchema.enum) property.enum = propSchema.enum
    if (propSchema.minimum !== undefined) property.minimum = propSchema.minimum
    if (propSchema.maximum !== undefined) property.maximum = propSchema.maximum

    if (propSchema.type === 'object' && propSchema.properties) {
      const nestedProps = jsonSchemaToProperties({ type: 'object', properties: propSchema.properties })
      property.properties = {}
      nestedProps.forEach(p => {
        const { name: _, id: __, ...rest } = p
        property.properties![p.name] = rest
      })
    }

    if (propSchema.type === 'array' && propSchema.items) {
      const itemSchema = propSchema.items as JSONSchema
      property.items = {
        type: (itemSchema.type as PropertyType) || 'string',
        ...(itemSchema.format && { format: itemSchema.format }),
        ...(itemSchema.enum && { enum: itemSchema.enum }),
        ...(itemSchema.minimum !== undefined && { minimum: itemSchema.minimum }),
        ...(itemSchema.maximum !== undefined && { maximum: itemSchema.maximum }),
      }
    }

    return property
  })
}

/**
 * Schema model + validation + mutation logic for the step schema editor.
 *
 * Owns the visual/code dual representation of a JSON Schema (as a flat list of
 * `Property` rows), keeps it in sync with the incoming `value` prop, and
 * exposes the mutation handlers the composition root wires up to the visual
 * property list and the raw-JSON code editor.
 */
export function useSchemaModel(value: JSONSchema | null, onChange: (schema: JSONSchema | null) => void) {
  const [properties, setProperties] = useUIState<Property[]>('schema-editor.properties', jsonSchemaToProperties(value))
  const [viewMode, setViewMode] = useUIState<'visual' | 'code'>('schema-editor.view-mode', 'visual')
  const [codeValue, setCodeValue] = useUIState('schema-editor.code-value', value ? JSON.stringify(value, null, 2) : '')

  useEffect(() => {
    const converted = jsonSchemaToProperties(value)
    setProperties(converted)
    setCodeValue(value ? JSON.stringify(value, null, 2) : '')
  }, [value])

  const handlePropertiesChange = (newProperties: Property[]) => {
    setProperties(newProperties)
    const requiredFields = newProperties.filter(p => p.required).map(p => p.name)
    onChange(newProperties.length > 0 ? propertiesToJsonSchema(newProperties, requiredFields) : null)
  }

  const handleSwitchToCode = () => {
    const requiredFields = properties.filter(p => p.required).map(p => p.name)
    const currentSchema = properties.length > 0 ? propertiesToJsonSchema(properties, requiredFields) : null
    setCodeValue(currentSchema ? JSON.stringify(currentSchema, null, 2) : '')
    setViewMode('code')
  }

  const handleCodeChange = (newValue: string) => {
    setCodeValue(newValue)
    try {
      const parsed = JSON.parse(newValue)
      onChange(parsed)
    } catch {
      // Invalid JSON, don't update
    }
  }

  const handleAddProperty = () => {
    const newProp: Property = {
      id: generateId(),
      name: `field_${properties.length + 1}`,
      type: 'string',
      required: false,
    }
    handlePropertiesChange([...properties, newProp])
  }

  return {
    properties,
    viewMode,
    setViewMode,
    codeValue,
    handlePropertiesChange,
    handleSwitchToCode,
    handleCodeChange,
    handleAddProperty,
  }
}

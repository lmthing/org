import { useUIState, useToggle } from '@lmthing/state'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Select, SelectOption } from '@lmthing/ui/elements/forms/select'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { cn } from '@lmthing/ui/lib/utils'
import type { Property, PropertyType } from './use-schema-model'

const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'string', label: 'Text (Paragraph / Word)' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'List of Items' },
]

const STRING_FORMATS = ['date', 'date-time', 'email', 'uri', 'uuid', 'time', 'duration']

const TYPE_ICON_CLASS: Record<PropertyType, string> = {
  string: 'property-row__type-icon--string',
  number: 'property-row__type-icon--number',
  boolean: 'property-row__type-icon--boolean',
  object: 'property-row__type-icon--object',
  array: 'property-row__type-icon--array',
}

function TypeIcon({ type }: { type: PropertyType }) {
  const icons = {
    string: (
      <svg className="property-row__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 7V4h16v3M9 20h6M12 4v16" />
      </svg>
    ),
    number: (
      <svg className="property-row__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 7V4h3M17 4h3v3M21 17v3h-3M7 20H4v-3M8 9h8M12 9v6" />
      </svg>
    ),
    boolean: (
      <svg className="property-row__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    object: (
      <svg className="property-row__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 7h10M7 12h10M7 17h6" />
      </svg>
    ),
    array: (
      <svg className="property-row__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    ),
  }
  return icons[type] || icons.string
}

export function PropertyRow({
  property,
  index: _index,
  onUpdate,
  onDelete,
  onToggleRequired,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  property: Property
  index: number
  onUpdate: (property: Property) => void
  onDelete: () => void
  onToggleRequired: () => void
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [isExpanded, toggleIsExpanded] = useToggle(`schema-editor.property-expanded.${property.id || property.name}`, false)
  const [enumInput, setEnumInput] = useUIState(`schema-editor.property-enum.${property.id || property.name}`, property.enum?.join(', ') || '')

  const hasNestedConfig = property.type === 'object' || property.type === 'array'
  const showTypeSpecific = property.type === 'string' || property.type === 'number'

  return (
    <div className="property-row">
      {/* Main row */}
      <div className={cn(
             'property-row__main',
             hasNestedConfig && 'property-row__main--clickable'
           )}
           onClick={() => hasNestedConfig && toggleIsExpanded()}>
        {/* Move buttons */}
        <div className="property-row__move-buttons" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" onClick={onMoveUp} disabled={isFirst}>
            <svg className="property-row__move-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </Button>
          <Button variant="ghost" size="icon" onClick={onMoveDown} disabled={isLast}>
            <svg className="property-row__move-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </Button>
        </div>

        {/* Expand/collapse for nested types */}
        {hasNestedConfig && (
          <button className="property-row__expand-btn" onClick={(e) => { e.stopPropagation(); toggleIsExpanded() }}>
            <svg className={cn('property-row__expand-icon', isExpanded && 'property-row__expand-icon--open')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Property name */}
        <Input
          type="text"
          value={property.name}
          onChange={(e) => onUpdate({ ...property, name: e.target.value })}
          placeholder="property_name"
          onClick={(e) => e.stopPropagation()}
          className="property-row__name-input"
        />

        {/* Type selector */}
        <Select
          value={property.type}
          onChange={(e) => onUpdate({ ...property, type: e.target.value as PropertyType })}
          onClick={(e) => e.stopPropagation()}
        >
          {TYPE_OPTIONS.map(opt => (
            <SelectOption key={opt.value} value={opt.value}>{opt.label}</SelectOption>
          ))}
        </Select>

        {/* Type icon badge */}
        <span className={cn('property-row__type-icon', TYPE_ICON_CLASS[property.type])}>
          <TypeIcon type={property.type} />
        </span>

        {/* Required toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleRequired() }}
          className={cn(
            'property-row__required-btn',
            property.required ? 'property-row__required-btn--required' : 'property-row__required-btn--optional'
          )}
        >
          {property.required ? 'required' : 'optional'}
        </button>

        {/* Description hint */}
        {property.description && (
          <Caption muted className="property-row__description-hint" title={property.description}>
            {property.description}
          </Caption>
        )}

        {/* Actions */}
        <div className="property-row__actions">
          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <svg className="property-row__delete-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Type-specific options panel */}
      {showTypeSpecific && (
        <div className="property-row__type-options">
          <div className="property-row__type-options-inner">
            {property.type === 'string' && (
              <Select
                value={property.format || ''}
                onChange={(e) => onUpdate({ ...property, format: e.target.value || undefined })}
              >
                <SelectOption value="">No format</SelectOption>
                {STRING_FORMATS.map(f => (
                  <SelectOption key={f} value={f}>{f}</SelectOption>
                ))}
              </Select>
            )}

            {property.type === 'string' && (
              <div className="property-row__enum-input">
                <Input
                  type="text"
                  value={enumInput}
                  onChange={(e) => {
                    setEnumInput(e.target.value)
                    const values = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                    onUpdate({ ...property, enum: values.length > 0 ? values : undefined })
                  }}
                  placeholder="enum: value1, value2, value3"
                />
              </div>
            )}

            {property.type === 'number' && (
              <div className="property-row__range-inputs">
                <Input
                  type="number"
                  value={property.minimum ?? ''}
                  onChange={(e) => onUpdate({ ...property, minimum: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="Min"
                  className="property-row__range-input"
                />
                <span className="property-row__range-arrow">&rarr;</span>
                <Input
                  type="number"
                  value={property.maximum ?? ''}
                  onChange={(e) => onUpdate({ ...property, maximum: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="Max"
                  className="property-row__range-input"
                />
              </div>
            )}

            <Input
              type="text"
              value={property.description || ''}
              onChange={(e) => onUpdate({ ...property, description: e.target.value || undefined })}
              placeholder="Description"
              className="property-row__description-input"
            />
          </div>
        </div>
      )}

      {/* Nested properties (object type) */}
      {property.type === 'object' && isExpanded && (
        <div className="property-row__nested">
          <NestedPropertiesEditor
            properties={property.properties || {}}
            onChange={(props) => onUpdate({ ...property, properties: props })}
          />
        </div>
      )}

      {/* Array items */}
      {property.type === 'array' && isExpanded && (
        <div className="property-row__nested">
          <Label compact>Array Item Type</Label>
          {property.items ? (
            <div className="property-row__array-item">
              <div className="property-row__array-item-inner">
                <Caption muted>Type</Caption>
                <Select
                  value={property.items.type}
                  onChange={(e) => onUpdate({
                    ...property,
                    items: { ...property.items, type: e.target.value as PropertyType }
                  })}
                >
                  {TYPE_OPTIONS.map(opt => (
                    <SelectOption key={opt.value} value={opt.value}>{opt.label}</SelectOption>
                  ))}
                </Select>

                <span className={cn('property-row__type-icon', TYPE_ICON_CLASS[property.items.type])}>
                  <TypeIcon type={property.items.type} />
                </span>

                <div className="property-row__array-spacer" />

                <Button variant="ghost" size="icon" onClick={() => onUpdate({ ...property, items: undefined })}>
                  <svg className="property-row__delete-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => onUpdate({ ...property, items: { type: 'string' } })}
              className="property-row__add-item-btn"
            >
              + Define array item type
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function NestedPropertiesEditor({
  properties,
  onChange,
}: {
  properties: Record<string, Omit<Property, 'name' | 'required' | 'id'>>
  onChange: (properties: Record<string, Omit<Property, 'name' | 'required' | 'id'>>) => void
}) {
  const entries = Object.entries(properties)

  const handleUpdateProperty = (key: string, updates: Partial<Property>) => {
    const current = properties[key]
    const updated = { ...current, ...updates }
    onChange({ ...properties, [key]: updated })
  }

  const handleDeleteProperty = (key: string) => {
    const newProps = { ...properties }
    delete newProps[key]
    onChange(newProps)
  }

  const handleRenameProperty = (oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) return
    const newProps: Record<string, Omit<Property, 'name' | 'required' | 'id'>> = {}
    Object.entries(properties).forEach(([k, v]) => {
      newProps[k === oldKey ? newKey : k] = v
    })
    onChange(newProps)
  }

  const handleMoveProperty = (fromIndex: number, toIndex: number) => {
    const keys = Object.keys(properties)
    if (toIndex < 0 || toIndex >= keys.length) return

    const newKeys = [...keys]
    const [moved] = newKeys.splice(fromIndex, 1)
    newKeys.splice(toIndex, 0, moved)

    const newProps: Record<string, Omit<Property, 'name' | 'required' | 'id'>> = {}
    newKeys.forEach(key => {
      newProps[key] = properties[key]
    })
    onChange(newProps)
  }

  const handleAddProperty = () => {
    const newKey = `property_${entries.length + 1}`
    onChange({ ...properties, [newKey]: { type: 'string' } })
  }

  return (
    <div className="nested-properties">
      {entries.map(([key, prop], index) => (
        <PropertyRow
          key={key}
          property={{ ...prop, name: key, required: false }}
          index={index}
          onUpdate={(updates) => {
            if (updates.name !== key) {
              handleRenameProperty(key, updates.name)
            }
            handleUpdateProperty(key, updates)
          }}
          onDelete={() => handleDeleteProperty(key)}
          onToggleRequired={() => {}}
          isFirst={index === 0}
          isLast={index === entries.length - 1}
          onMoveUp={() => handleMoveProperty(index, index - 1)}
          onMoveDown={() => handleMoveProperty(index, index + 1)}
        />
      ))}
      <Button variant="ghost" onClick={handleAddProperty} className="nested-properties__add-btn">
        <svg className="nested-properties__add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add nested property
      </Button>
    </div>
  )
}

import * as Prim from '../../../../elements/primitives/index.js';
import { useUIState, useToggle } from '@lmthing/state'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Select, SelectOption } from '@lmthing/ui/elements/forms/select'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { cn } from '@lmthing/ui/lib/utils'
import type { Property, PropertyType } from './use-schema-model'
import { NESTED_PROPERTIES_ADD_BTN, NESTED_PROPERTIES_ADD_ICON, PROPERTY_ROW_DELETE_ICON, PROPERTY_ROW_DESCRIPTION_HINT, PROPERTY_ROW_DESCRIPTION_INPUT, PROPERTY_ROW_ICON, PROPERTY_ROW_MOVE_ICON, PROPERTY_ROW_RANGE_INPUT } from '../../step-schema-editor.props.js'

const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'string', label: 'Text (Paragraph / Word)' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'List of Items' },
]

const STRING_FORMATS = ['date', 'date-time', 'email', 'uri', 'uuid', 'time', 'duration']

// .property-row__type-icon--<type> color modifiers → style lookup (its retired `styled()` proof proof)
const TYPE_ICON_STYLE: Record<PropertyType, { backgroundColor: string; color: string }> = {
  string: { backgroundColor: 'color-mix(in srgb, var(--brand-1) 15%, transparent)', color: '$brand-1' },
  number: { backgroundColor: 'color-mix(in srgb, var(--brand-2) 15%, transparent)', color: '$brand-2' },
  boolean: { backgroundColor: 'color-mix(in srgb, var(--brand-2) 15%, transparent)', color: '$brand-2' },
  object: { backgroundColor: 'color-mix(in srgb, var(--brand-3) 15%, transparent)', color: '$brand-3' },
  array: { backgroundColor: 'color-mix(in srgb, var(--destructive) 15%, transparent)', color: '$destructive' },
}

function TypeIcon({ type }: { type: PropertyType }) {
  const icons = {
    string: (
      <Prim.Svg {...PROPERTY_ROW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <Prim.Path d="M4 7V4h16v3M9 20h6M12 4v16" />
      </Prim.Svg>
    ),
    number: (
      <Prim.Svg {...PROPERTY_ROW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <Prim.Path d="M4 7V4h3M17 4h3v3M21 17v3h-3M7 20H4v-3M8 9h8M12 9v6" />
      </Prim.Svg>
    ),
    boolean: (
      <Prim.Svg {...PROPERTY_ROW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <Prim.Path d="M12 2L2 7l10 5 10-5-10-5z" />
        <Prim.Path d="M2 17l10 5 10-5" />
        <Prim.Path d="M2 12l10 5 10-5" />
      </Prim.Svg>
    ),
    object: (
      <Prim.Svg {...PROPERTY_ROW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <Prim.Path d="M7 7h10M7 12h10M7 17h6" />
      </Prim.Svg>
    ),
    array: (
      <Prim.Svg {...PROPERTY_ROW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <Prim.Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </Prim.Svg>
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
    <Prim.Box borderWidth={1} borderColor="$border" borderRadius="0.75rem" overflow="hidden" backgroundColor="$card">
      {/* Main row */}
      <Prim.Box
        display="flex"
        alignItems="center"
        gap="$3"
        padding="$3"
        {...(hasNestedConfig ? { cursor: 'pointer', hoverStyle: { backgroundColor: '$muted' } } : {})}
        onClick={() => hasNestedConfig && toggleIsExpanded()}
      >
        {/* Move buttons */}
        <Prim.Box display="flex" flexDirection="column" gap="$0.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" onClick={onMoveUp} disabled={isFirst}>
            <Prim.Svg {...PROPERTY_ROW_MOVE_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <Prim.Path d="M12 19V5M5 12l7-7 7 7" />
            </Prim.Svg>
          </Button>
          <Button variant="ghost" size="icon" onClick={onMoveDown} disabled={isLast}>
            <Prim.Svg {...PROPERTY_ROW_MOVE_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <Prim.Path d="M12 5v14M5 12l7 7 7-7" />
            </Prim.Svg>
          </Button>
        </Prim.Box>

        {/* Expand/collapse for nested types */}
        {hasNestedConfig && (
          <Prim.Pressable padding="$1" borderRadius="$radius" color="$muted-foreground" hoverStyle={{ backgroundColor: '$muted' }} onClick={(e) => { e.stopPropagation(); toggleIsExpanded() }}>
            <Prim.Svg className={cn('property-row__expand-icon', isExpanded && 'property-row__expand-icon--open')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <Prim.Path d="M9 18l6-6-6-6" />
            </Prim.Svg>
          </Prim.Pressable>
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
        <Prim.Text padding="$1.5" borderRadius="$radius-lg" {...TYPE_ICON_STYLE[property.type]}>
          <TypeIcon type={property.type} />
        </Prim.Text>

        {/* Required toggle */}
        <Prim.Pressable
          onClick={(e) => { e.stopPropagation(); onToggleRequired() }}
          fontSize="$xs"
          fontWeight="$medium"
          paddingVertical="$1.5"
          paddingHorizontal="$2.5"
          borderRadius="0.5rem"
          transition="quick"
          {...(property.required
            ? {
                backgroundColor: 'color-mix(in srgb, var(--destructive) 15%, transparent)',
                color: '$destructive',
                outlineWidth: 1,
                outlineStyle: 'solid',
                outlineColor: 'color-mix(in srgb, var(--destructive) 30%, transparent)',
              }
            : {
                backgroundColor: '$muted',
                color: '$muted-foreground',
                hoverStyle: { backgroundColor: '$muted' },
              })}
        >
          {property.required ? 'required' : 'optional'}
        </Prim.Pressable>

        {/* Description hint */}
        {property.description && (
          <Caption muted {...PROPERTY_ROW_DESCRIPTION_HINT} title={property.description}>
            {property.description}
          </Caption>
        )}

        {/* Actions */}
        <Prim.Box display="flex" alignItems="center" gap="$1">
          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Prim.Svg {...PROPERTY_ROW_DELETE_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <Prim.Path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </Prim.Svg>
          </Button>
        </Prim.Box>
      </Prim.Box>

      {/* Type-specific options panel */}
      {showTypeSpecific && (
        <Prim.Box paddingTop={0} paddingHorizontal="$3" paddingBottom="$3" borderTopWidth={1} borderTopColor="$border">
          <Prim.Box display="flex" alignItems="center" gap="$4" paddingTop="$3">
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
              <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%">
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
              </Prim.Box>
            )}

            {property.type === 'number' && (
              <Prim.Box display="flex" alignItems="center" gap="$2">
                <Input
                  type="number"
                  value={property.minimum ?? ''}
                  onChange={(e) => onUpdate({ ...property, minimum: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="Min"
                  {...PROPERTY_ROW_RANGE_INPUT}
                />
                <Prim.Text color="$muted-foreground">&rarr;</Prim.Text>
                <Input
                  type="number"
                  value={property.maximum ?? ''}
                  onChange={(e) => onUpdate({ ...property, maximum: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="Max"
                  {...PROPERTY_ROW_RANGE_INPUT}
                />
              </Prim.Box>
            )}

            <Input
              type="text"
              value={property.description || ''}
              onChange={(e) => onUpdate({ ...property, description: e.target.value || undefined })}
              placeholder="Description"
              {...PROPERTY_ROW_DESCRIPTION_INPUT}
            />
          </Prim.Box>
        </Prim.Box>
      )}

      {/* Nested properties (object type) */}
      {property.type === 'object' && isExpanded && (
        <Prim.Box borderTopWidth={1} borderTopColor="$border" padding="$3" backgroundColor="color-mix(in srgb, var(--muted) 50%, transparent)">
          <NestedPropertiesEditor
            properties={property.properties || {}}
            onChange={(props) => onUpdate({ ...property, properties: props })}
          />
        </Prim.Box>
      )}

      {/* Array items */}
      {property.type === 'array' && isExpanded && (
        <Prim.Box borderTopWidth={1} borderTopColor="$border" padding="$3" backgroundColor="color-mix(in srgb, var(--muted) 50%, transparent)">
          <Label compact>Array Item Type</Label>
          {property.items ? (
            <Prim.Box backgroundColor="$card" borderRadius="0.5rem" borderWidth={1} borderColor="$border" padding="$3" marginTop="$2">
              <Prim.Box display="flex" alignItems="center" gap="$3">
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

                <Prim.Text padding="$1.5" borderRadius="$radius-lg" {...TYPE_ICON_STYLE[property.items.type]}>
                  <TypeIcon type={property.items.type} />
                </Prim.Text>

                <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" />

                <Button variant="ghost" size="icon" onClick={() => onUpdate({ ...property, items: undefined })}>
                  <Prim.Svg {...PROPERTY_ROW_DELETE_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <Prim.Path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </Prim.Svg>
                </Button>
              </Prim.Box>
            </Prim.Box>
          ) : (
            <Prim.Pressable
              onClick={() => onUpdate({ ...property, items: { type: 'string' } })}
              width="100%"
              fontSize="$sm"
              padding="$2"
              marginTop="$2"
              borderRadius="0.5rem"
              borderWidth={2}
              borderStyle="dashed"
              borderColor="$border"
              color="$muted-foreground"
              transition="quick" animateOnly={["color", "background-color", "border-color"]}
              hoverStyle={{ borderColor: '$brand-3', color: '$brand-3' }}
            >
              + Define array item type
            </Prim.Pressable>
          )}
        </Prim.Box>
      )}
    </Prim.Box>
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
    <Prim.Box display="flex" flexDirection="column" gap="$2">
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
      <Button variant="ghost" onClick={handleAddProperty} {...NESTED_PROPERTIES_ADD_BTN}>
        <Prim.Svg {...NESTED_PROPERTIES_ADD_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <Prim.Path d="M12 5v14M5 12h14" />
        </Prim.Svg>
        Add nested property
      </Button>
    </Prim.Box>
  )
}

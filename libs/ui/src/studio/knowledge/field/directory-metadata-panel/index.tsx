import * as Prim from '../../../../elements/primitives/index';
import { useEffect, useCallback } from 'react'
import { useUIState, useSpaceFS, useKnowledgeFieldIndex, serializeKnowledgeFieldIndex } from '@lmthing/state'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { BookOpen } from 'lucide-react'
import { INPUT_BASE } from '../../../../elements/forms/input/index'
import { DIR_METADATA_HEADER, DIR_METADATA_ICON } from '../../props'

interface FieldIndexPanelProps {
  domain: string
  field: string
}

/**
 * `fieldType` is a UI hint for how to render/ask for this field — the value
 * must name a control available in the catalog (see org/format/space/components "Built-in
 * catalog components", Form section). Field-level `renderAs` was removed —
 * rendering is inferred from `fieldType`.
 */
const FIELD_TYPE_OPTIONS = [
  { value: '', label: '— none (use type default) —' },
  { value: 'text', label: 'Text (TextField)' },
  { value: 'textarea', label: 'Text area (TextArea)' },
  { value: 'number', label: 'Number (NumberField)' },
  { value: 'select', label: 'Select (Select)' },
  { value: 'multiselect', label: 'Multi-select (MultiSelect)' },
  { value: 'combobox', label: 'Combobox' },
  { value: 'radio', label: 'Radio group (RadioGroup)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'toggle', label: 'Toggle (Switch)' },
  { value: 'slider', label: 'Slider' },
  { value: 'date', label: 'Date (DatePicker)' },
] as const

export function FieldIndexPanel({ domain, field }: FieldIndexPanelProps) {
  const spaceFS = useSpaceFS()
  const indexPath = `knowledge/${domain}/${field}/index.md`
  const parsed = useKnowledgeFieldIndex(domain, field)

  const [type, setType] = useUIState<string>('field-index-panel.type', 'string')
  const [label, setLabel] = useUIState<string>('field-index-panel.label', '')
  const [variable, setVariable] = useUIState<string>('field-index-panel.variable', '')
  const [defaultVal, setDefaultVal] = useUIState<string>('field-index-panel.default', '')
  const [fieldType, setFieldType] = useUIState<string>('field-index-panel.field-type', '')
  const [required, setRequired] = useUIState<boolean>('field-index-panel.required', false)
  const [description, setDescription] = useUIState<string>('field-index-panel.description', '')
  const [isDirty, setIsDirty] = useUIState<boolean>('field-index-panel.is-dirty', false)

  useEffect(() => {
    if (!parsed) return
    setType(parsed.type || 'string')
    setLabel(parsed.label || '')
    setVariable(parsed.variable || '')
    setDefaultVal(parsed.default || '')
    setFieldType(parsed.fieldType || '')
    setRequired(parsed.required ?? false)
    setDescription(parsed.description || '')
    setIsDirty(false)
  }, [parsed])

  const markDirty = useCallback(() => setIsDirty(true), [])

  const handleSave = useCallback(() => {
    if (!spaceFS) return
    const content = serializeKnowledgeFieldIndex(
      {
        type,
        ...(label ? { label } : {}),
        variable,
        ...(defaultVal ? { default: defaultVal } : {}),
        ...(fieldType ? { fieldType } : {}),
        ...(required ? { required } : {}),
      },
      description
    )
    spaceFS.writeFile(indexPath, content)
    setIsDirty(false)
  }, [spaceFS, indexPath, type, label, variable, defaultVal, fieldType, required, description])

  return (
    <Prim.Box padding="$6" maxWidth={512}>
      <Stack gap="md">
        <Stack row {...DIR_METADATA_HEADER}>
          <BookOpen {...DIR_METADATA_ICON} />
          <Prim.Box>
            <Heading level={3}>{field}</Heading>
            <Caption muted>{indexPath}</Caption>
          </Prim.Box>
        </Stack>

        <Prim.Box>
          <Label compact>Type</Label>
          <Prim.Select
            {...INPUT_BASE}
            value={type}
            onChange={e => { setType(e.target.value); markDirty() }}
          >
            <Prim.Option value="string">string</Prim.Option>
            <Prim.Option value="number">number</Prim.Option>
            <Prim.Option value="boolean">boolean</Prim.Option>
            <Prim.Option value="object">object</Prim.Option>
            <Prim.Option value="array">array</Prim.Option>
          </Prim.Select>
        </Prim.Box>

        <Prim.Box>
          <Label compact>Label</Label>
          <Input
            type="text"
            value={label}
            onChange={e => { setLabel(e.target.value); markDirty() }}
            placeholder="Human-readable label (optional)"
          />
          <Caption muted>Display name shown in studio UI. If blank, the field dir name is used.</Caption>
        </Prim.Box>

        <Prim.Box>
          <Label compact>Variable</Label>
          <Input
            type="text"
            value={variable}
            onChange={e => { setVariable(e.target.value); markDirty() }}
            placeholder="camelCaseVar"
          />
          <Caption muted>JS identifier injected into agent context. If blank, inferred from the field directory name.</Caption>
        </Prim.Box>

        <Prim.Box>
          <Label compact>Default Option</Label>
          <Input
            type="text"
            value={defaultVal}
            onChange={e => { setDefaultVal(e.target.value); markDirty() }}
            placeholder="option-slug (optional)"
          />
        </Prim.Box>

        <Prim.Box>
          <Label compact>Field Type</Label>
          <Prim.Select
            {...INPUT_BASE}
            value={fieldType}
            onChange={e => { setFieldType(e.target.value); markDirty() }}
          >
            {FIELD_TYPE_OPTIONS.map(opt => (
              <Prim.Option key={opt.value} value={opt.value}>{opt.label}</Prim.Option>
            ))}
          </Prim.Select>
          <Caption muted>UI hint: how studio/chat should render or ask for this field. Must name a catalog form control.</Caption>
        </Prim.Box>

        <Prim.Box>
          <Label compact>Required</Label>
          <Prim.Text as="label" display="flex" alignItems="center" gap="0.5rem" cursor="pointer">
            <Prim.TextField
              type="checkbox"
              checked={required}
              onChange={e => { setRequired(e.target.checked); markDirty() }}
            />
            <Caption>This field must be filled before the agent runs</Caption>
          </Prim.Text>
        </Prim.Box>

        <Prim.Box>
          <Label compact>Description</Label>
          <Textarea
            value={description}
            onChange={e => { setDescription(e.target.value); markDirty() }}
            placeholder="Describe what this field controls..."
            compact
          />
        </Prim.Box>

        <Prim.Box display="flex" justifyContent="flex-end" paddingTop="$2">
          <Button variant="primary" size="sm" disabled={!isDirty} onClick={handleSave}>
            Save
          </Button>
        </Prim.Box>
      </Stack>
    </Prim.Box>
  )
}

// Backward-compat alias
export { FieldIndexPanel as DirectoryMetadataPanel }

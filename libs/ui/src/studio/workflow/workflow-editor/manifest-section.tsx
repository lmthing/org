/**
 * ManifestSection — editor for the tasklist-level manifest (index.md):
 * description + input schema.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { SchemaEditor } from './schema-editor'
import type { ManifestDraft } from './types'
import { TASKLIST_EDITOR_MANIFEST, TASKLIST_EDITOR_MANIFEST_BODY, TASKLIST_EDITOR_MANIFEST_HEADER } from './tasklist-editor.props.js'

export interface ManifestSectionProps {
  draft: ManifestDraft
  onChange: (draft: ManifestDraft) => void
}

export function ManifestSection({ draft, onChange }: ManifestSectionProps) {
  return (
    <Prim.Box {...TASKLIST_EDITOR_MANIFEST}>
      <Prim.Box {...TASKLIST_EDITOR_MANIFEST_HEADER}>
        <Heading level={3}>Manifest</Heading>
        <Caption muted>Tasklist-level input schema and description (index.md)</Caption>
      </Prim.Box>
      <Prim.Box {...TASKLIST_EDITOR_MANIFEST_BODY}>
        {/* description */}
        <Prim.Box>
          <Label compact>Description</Label>
          <Textarea
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            placeholder="Describe what this tasklist accomplishes..."
            compact
          />
        </Prim.Box>

        {/* input schema */}
        <Prim.Box>
          <Label compact>Input fields</Label>
          <SchemaEditor
            rows={draft.input}
            onChange={(rows) => onChange({ ...draft, input: rows })}
            addLabel="+ Add input field"
            emptyHint="No input fields defined. Add fields if this tasklist requires external inputs."
          />
          <Caption muted>Declare the fields callers must supply when running this tasklist.</Caption>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

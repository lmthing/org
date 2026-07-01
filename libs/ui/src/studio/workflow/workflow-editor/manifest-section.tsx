/**
 * ManifestSection — editor for the tasklist-level manifest (index.md):
 * description + input schema.
 */
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { SchemaEditor } from './schema-editor'
import type { ManifestDraft } from './types'

export interface ManifestSectionProps {
  draft: ManifestDraft
  onChange: (draft: ManifestDraft) => void
}

export function ManifestSection({ draft, onChange }: ManifestSectionProps) {
  return (
    <div className="tasklist-editor__manifest">
      <div className="tasklist-editor__manifest-header">
        <Heading level={3}>Manifest</Heading>
        <Caption muted>Tasklist-level input schema and description (index.md)</Caption>
      </div>
      <div className="tasklist-editor__manifest-body">
        {/* description */}
        <div>
          <Label compact>Description</Label>
          <Textarea
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            placeholder="Describe what this tasklist accomplishes..."
            compact
          />
        </div>

        {/* input schema */}
        <div>
          <Label compact>Input fields</Label>
          <SchemaEditor
            rows={draft.input}
            onChange={(rows) => onChange({ ...draft, input: rows })}
            addLabel="+ Add input field"
            emptyHint="No input fields defined. Add fields if this tasklist requires external inputs."
          />
          <Caption muted>Declare the fields callers must supply when running this tasklist.</Caption>
        </div>
      </div>
    </div>
  )
}

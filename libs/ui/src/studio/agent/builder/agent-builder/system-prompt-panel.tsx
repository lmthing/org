import * as Prim from '../../../../elements/primitives/index.js';
import { Label } from '@lmthing/ui/elements/typography/label'
import { PANEL_BASE, PANEL_BODY, PANEL_HEADER } from '../../../../elements/content/panel/index.js'
import { INPUT_BASE } from '../../../../elements/forms/input/index.js'

/** System Prompt Body panel */
export function SystemPromptPanel({ body, onChange }: {
  body: string
  onChange: (next: string) => void
}) {
  return (
    <Prim.Box {...PANEL_BASE}>
      <Prim.Box {...PANEL_HEADER}><Label>System Prompt</Label></Prim.Box>
      <Prim.Box {...PANEL_BODY}>
        <Prim.TextArea
          {...INPUT_BASE} className="agent-builder__textarea"
          value={body}
          onChange={e => onChange(e.target.value)}
          placeholder="Write the agent's system prompt here..."
          rows={10}
        />
      </Prim.Box>
    </Prim.Box>
  )
}

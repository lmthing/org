import * as Prim from '../../../../elements/primitives/index.js';
import { Label } from '@lmthing/ui/elements/typography/label'

/** System Prompt Body panel */
export function SystemPromptPanel({ body, onChange }: {
  body: string
  onChange: (next: string) => void
}) {
  return (
    <Prim.Box className="panel">
      <Prim.Box className="panel__header"><Label>System Prompt</Label></Prim.Box>
      <Prim.Box className="panel__body">
        <Prim.TextArea
          className="input agent-builder__textarea"
          value={body}
          onChange={e => onChange(e.target.value)}
          placeholder="Write the agent's system prompt here..."
          rows={10}
        />
      </Prim.Box>
    </Prim.Box>
  )
}

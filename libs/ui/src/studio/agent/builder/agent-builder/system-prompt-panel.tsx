import { Label } from '@lmthing/ui/elements/typography/label'

/** System Prompt Body panel */
export function SystemPromptPanel({ body, onChange }: {
  body: string
  onChange: (next: string) => void
}) {
  return (
    <div className="panel">
      <div className="panel__header"><Label>System Prompt</Label></div>
      <div className="panel__body">
        <textarea
          className="input agent-builder__textarea"
          value={body}
          onChange={e => onChange(e.target.value)}
          placeholder="Write the agent's system prompt here..."
          rows={10}
        />
      </div>
    </div>
  )
}

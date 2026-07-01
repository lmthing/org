import type { AgentInstruct } from '@lmthing/state'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Select, SelectOption } from '@lmthing/ui/elements/forms/select'

/** Default Action selector — only shown once at least one action exists */
export function DefaultActionPanel({ actions, value, onChange }: {
  actions: AgentInstruct['actions']
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="panel">
      <div className="panel__header"><Label>Default Action (optional)</Label></div>
      <div className="panel__body">
        <Select value={value} onChange={e => onChange(e.target.value)}>
          <SelectOption value="">— none —</SelectOption>
          {actions.filter(a => a.id).map(a => (
            <SelectOption key={a.id} value={a.id}>{a.label || a.id}</SelectOption>
          ))}
        </Select>
      </div>
    </div>
  )
}

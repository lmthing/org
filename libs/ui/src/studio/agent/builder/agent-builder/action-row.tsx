import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { Select, SelectOption } from '@lmthing/ui/elements/forms/select'

/** One action row */
export function ActionRow({ action, tasklistNames, onChange, onRemove }: {
  action: { id: string; label: string; description: string; tasklist: string }
  tasklistNames: string[]
  onChange: (updated: typeof action) => void
  onRemove: () => void
}) {
  return (
    <div className="panel agent-builder__action-row">
      <div className="panel__body">
        <Stack gap="sm">
          <Stack row gap="sm">
            <div style={{ flex: 1 }}>
              <Label compact>ID</Label>
              <Input value={action.id} onChange={e => onChange({ ...action, id: e.target.value })} placeholder="action-id" />
            </div>
            <div style={{ flex: 2 }}>
              <Label compact>Label</Label>
              <Input value={action.label} onChange={e => onChange({ ...action, label: e.target.value })} placeholder="Action label" />
            </div>
            <Button variant="ghost" size="sm" onClick={onRemove} style={{ alignSelf: 'flex-end' }}>✕</Button>
          </Stack>
          <div>
            <Label compact>Description</Label>
            <Input value={action.description} onChange={e => onChange({ ...action, description: e.target.value })} placeholder="What does this action do?" />
          </div>
          <div>
            <Label compact>Tasklist</Label>
            <Select value={action.tasklist} onChange={e => onChange({ ...action, tasklist: e.target.value })}>
              <SelectOption value="">— select tasklist —</SelectOption>
              {tasklistNames.map(name => (
                <SelectOption key={name} value={name}>{name}</SelectOption>
              ))}
            </Select>
          </div>
        </Stack>
      </div>
    </div>
  )
}

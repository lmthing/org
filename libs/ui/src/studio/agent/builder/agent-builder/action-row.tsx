import * as Prim from '../../../../elements/primitives/index';
import { Stack } from '../../../../elements/layouts/stack'
import { Label } from '../../../../elements/typography/label'
import { Button } from '../../../../elements/forms/button'
import { Input } from '../../../../elements/forms/input'
import { Select, SelectOption } from '../../../../elements/forms/select'
import { PANEL_BASE, PANEL_BODY } from '../../../../elements/content/panel/index'

/** One action row */
export function ActionRow({ action, tasklistNames, onChange, onRemove }: {
  action: { id: string; label: string; description: string; tasklist: string }
  tasklistNames: string[]
  onChange: (updated: typeof action) => void
  onRemove: () => void
}) {
  return (
    <Prim.Box {...PANEL_BASE}>
      <Prim.Box {...PANEL_BODY}>
        <Stack gap="sm">
          <Stack row gap="sm">
            <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%">
              <Label compact>ID</Label>
              <Input value={action.id} onChange={e => onChange({ ...action, id: e.target.value })} placeholder="action-id" />
            </Prim.Box>
            <Prim.Box flexGrow={2} flexShrink={1} flexBasis={0}>
              <Label compact>Label</Label>
              <Input value={action.label} onChange={e => onChange({ ...action, label: e.target.value })} placeholder="Action label" />
            </Prim.Box>
            <Button variant="ghost" size="sm" onClick={onRemove} alignSelf="flex-end">✕</Button>
          </Stack>
          <Prim.Box>
            <Label compact>Description</Label>
            <Input value={action.description} onChange={e => onChange({ ...action, description: e.target.value })} placeholder="What does this action do?" />
          </Prim.Box>
          <Prim.Box>
            <Label compact>Tasklist</Label>
            <Select value={action.tasklist} onChange={e => onChange({ ...action, tasklist: e.target.value })}>
              <SelectOption value="">— select tasklist —</SelectOption>
              {tasklistNames.map(name => (
                <SelectOption key={name} value={name}>{name}</SelectOption>
              ))}
            </Select>
          </Prim.Box>
        </Stack>
      </Prim.Box>
    </Prim.Box>
  )
}

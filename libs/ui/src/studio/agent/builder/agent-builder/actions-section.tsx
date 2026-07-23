import * as Prim from '../../../../elements/primitives/index.js';
import type { AgentInstruct } from '@lmthing/state'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { ActionRow } from './action-row'

/** Actions list panel — add/edit/remove action rows linking the agent to tasklists */
export function ActionsSection({ actions, tasklistNames, onAdd, onUpdate, onRemove }: {
  actions: AgentInstruct['actions']
  tasklistNames: string[]
  onAdd: () => void
  onUpdate: (idx: number, updated: AgentInstruct['actions'][number]) => void
  onRemove: (idx: number) => void
}) {
  return (
    <Prim.Box className="panel">
      <Prim.Box className="panel__header">
        <Stack row className="agent-builder__section-header-row">
          <Label>Actions ({actions.length})</Label>
          <Button variant="ghost" size="sm" onClick={onAdd}>+ Add Action</Button>
        </Stack>
      </Prim.Box>
      <Prim.Box className="panel__body">
        {actions.length === 0 ? (
          <Caption muted>No actions yet. Actions link this agent to a tasklist.</Caption>
        ) : (
          <Stack gap="md">
            {actions.map((action, idx) => (
              <ActionRow
                key={idx}
                action={action}
                tasklistNames={tasklistNames}
                onChange={updated => onUpdate(idx, updated)}
                onRemove={() => onRemove(idx)}
              />
            ))}
          </Stack>
        )}
      </Prim.Box>
    </Prim.Box>
  )
}

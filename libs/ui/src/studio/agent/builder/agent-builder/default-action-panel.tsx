import * as Prim from '../../../../elements/primitives/index';
import type { AgentInstruct } from '@lmthing/state'
import { Label } from '../../../../elements/typography/label'
import { Select, SelectOption } from '../../../../elements/forms/select'
import { PANEL_BASE, PANEL_BODY, PANEL_HEADER } from '../../../../elements/content/panel/index'

/** Default Action selector — only shown once at least one action exists */
export function DefaultActionPanel({ actions, value, onChange }: {
  actions: AgentInstruct['actions']
  value: string
  onChange: (next: string) => void
}) {
  return (
    <Prim.Box {...PANEL_BASE}>
      <Prim.Box {...PANEL_HEADER}><Label>Default Action (optional)</Label></Prim.Box>
      <Prim.Box {...PANEL_BODY}>
        <Select value={value} onChange={e => onChange(e.target.value)}>
          <SelectOption value="">— none —</SelectOption>
          {actions.filter(a => a.id).map(a => (
            <SelectOption key={a.id} value={a.id}>{a.label || a.id}</SelectOption>
          ))}
        </Select>
      </Prim.Box>
    </Prim.Box>
  )
}

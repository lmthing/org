import * as Prim from '../../../../elements/primitives/index.js';
import { useUIState } from '@lmthing/state'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Input } from '@lmthing/ui/elements/forms/input'
import { PANEL_BASE, PANEL_BODY, PANEL_HEADER } from '../../../../elements/content/panel/index.js'

/** Delegation editor (add/remove canDelegateTo string entries) */
export function CanDelegateToField({ refs, onChange }: {
  refs: string[]
  onChange: (next: string[]) => void
}) {
  const [newRef, setNewRef] = useUIState('agent-builder.new-delegate-ref', '')

  const add = () => {
    const v = newRef.trim()
    if (v && !refs.includes(v)) { onChange([...refs, v]); setNewRef('') }
  }
  const remove = (ref: string) => onChange(refs.filter(d => d !== ref))

  return (
    <Prim.Box {...PANEL_BASE}>
      <Prim.Box {...PANEL_HEADER}><Label>Can Delegate To ({refs.length})</Label></Prim.Box>
      <Prim.Box {...PANEL_BODY}>
        <Stack gap="sm">
          {refs.map(ref => (
            <Stack key={ref} row gap="sm" className="agent-builder__dep-row">
              <Caption className="agent-builder__dep-text">{ref}</Caption>
              <Button variant="ghost" size="sm" onClick={() => remove(ref)}>✕</Button>
            </Stack>
          ))}
          <Stack row gap="sm">
            <Input
              value={newRef}
              onChange={e => setNewRef(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
              placeholder="space-ref/agent-slug or agent-slug#action"
              className="agent-builder__dep-input"
            />
            <Button variant="ghost" size="sm" onClick={add} disabled={!newRef.trim()}>Add</Button>
          </Stack>
        </Stack>
      </Prim.Box>
    </Prim.Box>
  )
}

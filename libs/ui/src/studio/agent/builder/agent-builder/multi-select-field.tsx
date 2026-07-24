import * as Prim from '../../../../elements/primitives/index.js';
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { PANEL_BASE, PANEL_BODY, PANEL_HEADER } from '../../../../elements/content/panel/index.js'

/** Multiselect pill grid */
export function MultiSelectField({ label, available, selected, onChange }: {
  label: string
  available: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (item: string) => {
    onChange(selected.includes(item) ? selected.filter(x => x !== item) : [...selected, item])
  }
  return (
    <Prim.Box {...PANEL_BASE}>
      <Prim.Box {...PANEL_HEADER}>
        <Label>{label} ({selected.length}/{available.length})</Label>
      </Prim.Box>
      <Prim.Box {...PANEL_BODY}>
        {available.length === 0 ? (
          <Caption muted>None available in this space.</Caption>
        ) : (
          <Prim.Box className="agent-builder__pill-grid">
            {available.map(item => (
              <Prim.Pressable
                key={item}
                type="button"
                onClick={() => toggle(item)}
                className={`badge ${selected.includes(item) ? 'badge--primary' : 'badge--muted'} agent-builder__pill`}
              >
                {item}
              </Prim.Pressable>
            ))}
          </Prim.Box>
        )}
      </Prim.Box>
    </Prim.Box>
  )
}

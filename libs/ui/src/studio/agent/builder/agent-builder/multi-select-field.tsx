import * as Prim from '../../../../elements/primitives/index';
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { PANEL_BASE, PANEL_BODY, PANEL_HEADER } from '../../../../elements/content/panel/index'
import { BADGE_BASE, BADGE_VARIANT } from '../../../../elements/content/badge/index'

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
          <Prim.Box display="flex" flexWrap="wrap" gap="$2">
            {available.map(item => (
              <Prim.Pressable
                key={item}
                type="button"
                onClick={() => toggle(item)}
                {...BADGE_BASE}
                {...BADGE_VARIANT[selected.includes(item) ? 'primary' : 'muted']}
                cursor="pointer"
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

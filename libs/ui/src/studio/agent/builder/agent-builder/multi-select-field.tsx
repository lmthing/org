import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'

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
    <div className="panel">
      <div className="panel__header">
        <Label>{label} ({selected.length}/{available.length})</Label>
      </div>
      <div className="panel__body">
        {available.length === 0 ? (
          <Caption muted>None available in this space.</Caption>
        ) : (
          <div className="agent-builder__pill-grid">
            {available.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => toggle(item)}
                className={`badge ${selected.includes(item) ? 'badge--primary' : 'badge--muted'} agent-builder__pill`}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Web mirrors of the Ink input add-ons: `ink-text-input` (default export
 * TextInput), `ink-select-input` (SelectInput), plus ConfirmInput / MultiSelect.
 * Same prop shape as the terminal packages so single-source components work.
 */
import React from 'react';
import { Box, Text, inkColor } from './ink.js';

// ─── TextInput (mirrors ink-text-input) ───────────────────────────────────────

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  mask?: string; // password char
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  focus = true,
  mask,
}: TextInputProps): React.ReactElement {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <input
      ref={ref}
      type={mask ? 'password' : 'text'}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit?.(value);
      }}
      style={{
        background: 'var(--lm-bg, #0d1117)',
        color: 'var(--lm-text, #e6edf3)',
        border: '1px solid var(--lm-border, #30363d)',
        borderRadius: 6,
        padding: '4px 8px',
        font: 'inherit',
        outline: 'none',
        flex: 1,
        minWidth: 0,
      }}
    />
  );
}

export default TextInput;

// ─── SelectInput (mirrors ink-select-input) ───────────────────────────────────

export interface SelectItem<V = unknown> {
  label: string;
  value: V;
  key?: string;
}

export interface SelectInputProps<V = unknown> {
  items: SelectItem<V>[];
  onSelect?: (item: SelectItem<V>) => void;
  onHighlight?: (item: SelectItem<V>) => void;
  initialIndex?: number;
  isFocused?: boolean;
  itemComponent?: React.ComponentType<{ label: string; isSelected: boolean }>;
}

export function SelectInput<V = unknown>({
  items,
  onSelect,
  onHighlight,
  initialIndex = 0,
  isFocused = true,
}: SelectInputProps<V>): React.ReactElement {
  const [active, setActive] = React.useState(initialIndex);
  const move = (next: number) => {
    const i = (next + items.length) % items.length;
    setActive(i);
    const it = items[i];
    if (it) onHighlight?.(it);
  };
  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        const selected = i === active;
        return (
          <div
            key={it.key ?? String(i)}
            role="option"
            aria-selected={selected}
            tabIndex={isFocused ? 0 : -1}
            onMouseEnter={() => move(i)}
            onClick={() => onSelect?.(it)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); move(active + 1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); move(active - 1); }
              else if (e.key === 'Enter') { e.preventDefault(); const cur = items[active]; if (cur) onSelect?.(cur); }
            }}
            style={{ cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center', padding: '2px 4px', borderRadius: 4, background: selected ? 'color-mix(in srgb, var(--lm-accent, #58a6ff) 18%, transparent)' : undefined }}
          >
            <Text color={selected ? 'cyan' : undefined}>{selected ? '❯' : ' '}</Text>
            <Text color={selected ? 'cyan' : undefined}>{it.label}</Text>
          </div>
        );
      })}
    </Box>
  );
}

// ─── MultiSelect ───────────────────────────────────────────────────────────────

export function MultiSelect<V = unknown>({
  items,
  onSubmit,
  defaultSelected = [],
}: {
  items: SelectItem<V>[];
  onSubmit?: (selected: SelectItem<V>[]) => void;
  defaultSelected?: V[];
}): React.ReactElement {
  const [checked, setChecked] = React.useState<Set<V>>(new Set(defaultSelected));
  const toggle = (v: V) => {
    const next = new Set(checked);
    if (next.has(v)) next.delete(v); else next.add(v);
    setChecked(next);
  };
  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        const on = checked.has(it.value);
        return (
          <label key={it.key ?? String(i)} style={{ display: 'flex', gap: 6, cursor: 'pointer', padding: '1px 0' }}>
            <input type="checkbox" checked={on} onChange={() => toggle(it.value)} />
            <Text>{it.label}</Text>
          </label>
        );
      })}
      <button
        onClick={() => onSubmit?.(items.filter((it) => checked.has(it.value)))}
        style={{ marginTop: 6, alignSelf: 'flex-start', background: inkColor('blue'), color: 'var(--lm-bg)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
      >
        Submit
      </button>
    </Box>
  );
}

// ─── ConfirmInput (mirrors @inkjs/ui ConfirmInput) ─────────────────────────────

export function ConfirmInput({
  onConfirm,
  onCancel,
  defaultChoice = 'confirm',
}: {
  onConfirm?: () => void;
  onCancel?: () => void;
  defaultChoice?: 'confirm' | 'cancel';
}): React.ReactElement {
  return (
    <Box gap={2}>
      <button onClick={() => onConfirm?.()} style={btn(defaultChoice === 'confirm')}>Yes</button>
      <button onClick={() => onCancel?.()} style={btn(defaultChoice === 'cancel')}>No</button>
    </Box>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    background: primary ? inkColor('green') : 'transparent',
    color: primary ? 'var(--lm-bg)' : 'var(--lm-text)',
    border: `1px solid ${primary ? inkColor('green') : 'var(--lm-border, #30363d)'}`,
    borderRadius: 6,
    padding: '4px 12px',
    cursor: 'pointer',
    font: 'inherit',
  };
}

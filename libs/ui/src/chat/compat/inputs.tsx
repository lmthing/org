// ds-lint-file-ok: terminal ANSI color palette (Ink compat inputs, --lm-* terminal theme vars), not brand UI
/**
 * Web mirrors of the Ink input add-ons: `ink-text-input` (default export
 * TextInput), `ink-select-input` (SelectInput), plus ConfirmInput / MultiSelect.
 * Same prop shape as the terminal packages so single-source components work.
 */
import * as Prim from '../../elements/primitives/index.js';
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
    <Prim.TextField
      ref={ref}
      type={mask ? 'password' : 'text'}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit?.(value);
      }}
      backgroundColor="var(--lm-bg, #0d1117)"
      color="var(--lm-text, #e6edf3)"
      borderWidth={1}
      borderStyle="solid"
      borderColor="var(--lm-border, #30363d)"
      borderRadius={6}
      paddingVertical="4px"
      paddingHorizontal="8px"
      outlineWidth={0}
      outlineStyle="none"
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      minWidth={0}
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
          <Prim.Box
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
            cursor="pointer" display="flex" gap={6} alignItems="center" paddingVertical="2px" paddingHorizontal="4px" borderRadius={4} backgroundColor="selected ? 'color-mix(in srgb, var(--lm-accent, #58a6ff) 18%, transparent)' : undefined"
          >
            <Text color={selected ? 'cyan' : undefined}>{selected ? '❯' : ' '}</Text>
            <Text color={selected ? 'cyan' : undefined}>{it.label}</Text>
          </Prim.Box>
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
          <Prim.Text as="label" key={it.key ?? String(i)} display="flex" gap={6} cursor="pointer" paddingVertical="1px" paddingHorizontal="0">
            <Prim.TextField type="checkbox" checked={on} onChange={() => toggle(it.value)} />
            <Text>{it.label}</Text>
          </Prim.Text>
        );
      })}
      <Prim.Pressable
        onClick={() => onSubmit?.(items.filter((it) => checked.has(it.value)))}
        marginTop={6} alignSelf="flex-start" backgroundColor="inkColor('blue')" color="var(--lm-bg)" borderWidth={0} borderRadius={6} paddingVertical="4px" paddingHorizontal="10px" cursor="pointer"
      >
        Submit
      </Prim.Pressable>
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
      <Prim.Pressable onClick={() => onConfirm?.()} style={btn(defaultChoice === 'confirm')}>Yes</Prim.Pressable>
      <Prim.Pressable onClick={() => onCancel?.()} style={btn(defaultChoice === 'cancel')}>No</Prim.Pressable>
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

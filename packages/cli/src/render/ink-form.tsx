/**
 * Interactive terminal renderer for the design-system form catalog. Mirrors the
 * web `CatalogForm`: flattens an `ask()` descriptor via core's `flattenForm`,
 * then steps through fields one at a time (the robust terminal interaction
 * model), collecting + coercing values and resolving with a bare value (single
 * control) or an object keyed by field name (a `<Form>`).
 */
import React, { useState } from 'react';
import { Text, Box, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { flattenForm, coerceValue, defaultFor } from '@repl/core';
import type { FieldSpec } from '@repl/core';

// ─── single-choice list (select / radio / combobox / buttongroup) ─────────────

function ChoiceField({ field, onDone }: { field: FieldSpec; onDone: (v: unknown) => void }): React.ReactElement {
  const opts = field.options ?? [];
  const [active, setActive] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setActive((i) => (i - 1 + opts.length) % opts.length);
    else if (key.downArrow) setActive((i) => (i + 1) % opts.length);
    else if (key.return) onDone(opts[active]?.value);
  });
  return (
    <Box flexDirection="column">
      {opts.map((o, i) => (
        <Text key={i} color={i === active ? 'cyan' : undefined}>{i === active ? '❯ ' : '  '}{o.label}</Text>
      ))}
    </Box>
  );
}

// ─── multi-choice list (multiselect / checkboxgroup) ──────────────────────────

function MultiChoiceField({ field, onDone }: { field: FieldSpec; onDone: (v: unknown) => void }): React.ReactElement {
  const opts = field.options ?? [];
  const [active, setActive] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  useInput((input, key) => {
    if (key.upArrow) setActive((i) => (i - 1 + opts.length) % opts.length);
    else if (key.downArrow) setActive((i) => (i + 1) % opts.length);
    else if (input === ' ') setChecked((s) => { const n = new Set(s); n.has(active) ? n.delete(active) : n.add(active); return n; });
    else if (key.return) onDone([...checked].map((i) => opts[i]?.value));
  });
  return (
    <Box flexDirection="column">
      <Text dimColor>space to toggle · enter to confirm</Text>
      {opts.map((o, i) => (
        <Text key={i} color={i === active ? 'cyan' : undefined}>{i === active ? '❯ ' : '  '}[{checked.has(i) ? 'x' : ' '}] {o.label}</Text>
      ))}
    </Box>
  );
}

// ─── boolean (checkbox / switch / confirm) ────────────────────────────────────

function BooleanField({ onDone }: { field: FieldSpec; onDone: (v: unknown) => void }): React.ReactElement {
  const [yes, setYes] = useState(true);
  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || input === 'y' || input === 'n') setYes(input === 'y' ? true : input === 'n' ? false : !yes);
    else if (key.return) onDone(yes);
  });
  return <Text><Text color={yes ? 'green' : undefined}>{yes ? '❯ ' : '  '}Yes</Text>   <Text color={!yes ? 'red' : undefined}>{!yes ? '❯ ' : '  '}No</Text></Text>;
}

// ─── text-like (everything else) ──────────────────────────────────────────────

function TextField({ field, onDone }: { field: FieldSpec; onDone: (v: unknown) => void }): React.ReactElement {
  const [value, setValue] = useState(field.defaultValue !== undefined ? String(field.defaultValue) : '');
  const mask = field.kind === 'password' ? '*' : undefined;
  return (
    <Box>
      <Text color="cyan">&gt; </Text>
      <TextInput value={value} onChange={setValue} onSubmit={(v) => onDone(v)} mask={mask} placeholder={field.placeholder} />
    </Box>
  );
}

function renderControl(field: FieldSpec, onDone: (v: unknown) => void): React.ReactElement {
  switch (field.kind) {
    case 'select': case 'radio': case 'combobox': case 'buttongroup':
      return <ChoiceField field={field} onDone={onDone} />;
    case 'multiselect': case 'checkboxgroup':
      return <MultiChoiceField field={field} onDone={onDone} />;
    case 'checkbox': case 'switch': case 'confirm':
      return <BooleanField field={field} onDone={onDone} />;
    default:
      return <TextField field={field} onDone={onDone} />;
  }
}

export function InkForm({ descriptor, onSubmit }: { descriptor: unknown; onSubmit: (value: unknown) => void }): React.ReactElement {
  const spec = React.useMemo(() => flattenForm(descriptor), [descriptor]);
  const [step, setStep] = useState(0);
  const resultRef = React.useRef<Record<string, unknown>>({});

  if (spec.fields.length === 0) {
    // Not a form after all — shouldn't happen (caller checks), but be safe.
    return <Text dimColor>(no fields)</Text>;
  }

  const field = spec.fields[step]!;
  const onDone = (raw: unknown) => {
    const v = coerceValue(field, raw ?? defaultFor(field));
    resultRef.current[field.name] = v;
    if (step + 1 < spec.fields.length) {
      setStep(step + 1);
    } else if (spec.single) {
      onSubmit(coerceValue(spec.fields[0]!, resultRef.current[spec.fields[0]!.name]));
    } else {
      onSubmit({ ...resultRef.current });
    }
  };

  return (
    <Box flexDirection="column">
      {spec.fields.length > 1 && <Text dimColor>Step {step + 1}/{spec.fields.length}</Text>}
      {field.label ? <Text bold>{field.label}</Text> : null}
      {field.help ? <Text dimColor>{field.help}</Text> : null}
      {renderControl(field, onDone)}
    </Box>
  );
}

/**
 * Web renderer for the design-system form catalog. Given an `ask()` descriptor
 * (a bare control like `<Select/>` or a `<Form>` wrapper), it flattens the spec
 * via core's `flattenForm`, renders themed native controls, and submits a bare
 * value (single control) or an object keyed by field name (Form). Mirrors the
 * terminal `InkForm` so `ask(<Form>…</Form>)` behaves identically on both.
 */
import * as Prim from '../../../elements/primitives/index.js';
import React from 'react';
import { flattenForm, coerceValue, defaultFor } from '@lmthing/core/ui';
import type { FieldSpec } from '@lmthing/core/ui';

const inputStyle: React.CSSProperties = {
  background: 'var(--lm-bg)',
  color: 'var(--lm-text)',
  border: '1px solid var(--lm-border)',
  borderRadius: 'var(--radius-lm-md, 6px)',
  padding: '4px 8px',
  font: 'inherit',
  outline: 'none',
  width: '100%',
};

function Control({
  field,
  value,
  onChange,
  onEnter,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  onEnter: () => void;
}): React.ReactElement {
  const k = field.kind;
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') onEnter(); };

  switch (k) {
    case 'textarea':
      return <Prim.TextArea style={{ ...inputStyle, minHeight: (field.rows ?? 3) * 20 }} value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'select': case 'combobox':
      return (
        <Prim.Select style={inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o, i) => <Prim.Option key={i} value={String(o.value)}>{o.label}</Prim.Option>)}
        </Prim.Select>
      );
    case 'multiselect': case 'checkboxgroup': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <Prim.Box style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {field.options?.map((o, i) => (
            <Prim.Text as="label" key={i} style={{ display: 'flex', gap: 6, cursor: 'pointer' }}>
              <Prim.TextField type="checkbox" checked={arr.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((v) => v !== o.value))} />
              <Prim.Text>{o.label}</Prim.Text>
            </Prim.Text>
          ))}
        </Prim.Box>
      );
    }
    case 'radio':
      return (
        <Prim.Box style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {field.options?.map((o, i) => (
            <Prim.Text as="label" key={i} style={{ display: 'flex', gap: 6, cursor: 'pointer' }}>
              <Prim.TextField type="radio" name={field.name} checked={value === o.value} onChange={() => onChange(o.value)} />
              <Prim.Text>{o.label}</Prim.Text>
            </Prim.Text>
          ))}
        </Prim.Box>
      );
    case 'checkbox': case 'switch':
      return <Prim.TextField type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'slider':
      return <Prim.TextField type="range" style={{ width: '100%' }} min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />;
    case 'number': case 'stepper': case 'currency':
      return <Prim.TextField type="number" style={inputStyle} min={field.min} max={field.max} step={field.step} value={value === undefined || value === '' ? '' : Number(value)} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'rating': {
      const max = field.max ?? 5;
      const cur = Number(value ?? 0);
      return (
        <Prim.Box style={{ display: 'flex', gap: 2 }}>
          {Array.from({ length: max }, (_, i) => (
            <Prim.Pressable key={i} onClick={() => onChange(i + 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: i < cur ? 'var(--lm-amber)' : 'var(--lm-muted)', fontSize: 16 }}>★</Prim.Pressable>
          ))}
        </Prim.Box>
      );
    }
    case 'date': return <Prim.TextField type="date" style={inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'time': return <Prim.TextField type="time" style={inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime': return <Prim.TextField type="datetime-local" style={inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'color': return <Prim.TextField type="color" value={String(value || '#000000')} onChange={(e) => onChange(e.target.value)} />; // ds-lint-ok: default value for a native color picker, not a UI theme color
    case 'file': return <Prim.TextField type="text" style={inputStyle} placeholder={field.placeholder ?? 'path…'} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'taginput':
      return <Prim.TextField type="text" style={inputStyle} placeholder="comma,separated" value={Array.isArray(value) ? value.join(', ') : String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'password': return <Prim.TextField type="password" style={inputStyle} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'email': return <Prim.TextField type="email" style={inputStyle} placeholder={field.placeholder} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'otp': return <Prim.TextField type="text" inputMode="numeric" style={{ ...inputStyle, letterSpacing: 4 }} maxLength={field.length ?? 6} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Prim.TextField type="text" style={inputStyle} placeholder={field.placeholder} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
  }
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    background: primary ? 'color-mix(in srgb, var(--lm-accent) 20%, transparent)' : 'transparent',
    color: primary ? 'var(--lm-accent)' : 'var(--lm-text)',
    border: `1px solid ${primary ? 'var(--lm-accent)' : 'var(--lm-border)'}`,
    borderRadius: 'var(--radius-lm-md, 6px)',
    padding: '4px 12px',
    cursor: 'pointer',
    font: 'inherit',
  };
}

export function CatalogForm({
  descriptor,
  onSubmit,
}: {
  descriptor: unknown;
  onSubmit: (value: unknown) => void;
}): React.ReactElement {
  const spec = React.useMemo(() => flattenForm(descriptor), [descriptor]);
  const [values, setValues] = React.useState<Record<string, unknown>>(() =>
    Object.fromEntries(spec.fields.map((f) => [f.name, defaultFor(f)])),
  );
  const set = (name: string, v: unknown) => setValues((prev) => ({ ...prev, [name]: v }));

  const submit = () => {
    if (spec.single && spec.fields[0]) {
      onSubmit(coerceValue(spec.fields[0], values[spec.fields[0].name]));
    } else {
      const out: Record<string, unknown> = {};
      for (const f of spec.fields) out[f.name] = coerceValue(f, values[f.name]);
      onSubmit(out);
    }
  };

  // Bare confirm / buttongroup resolve immediately on click (no submit row).
  const only = spec.fields.length === 1 ? spec.fields[0] : undefined;
  if (spec.single && only && (only.kind === 'confirm' || only.kind === 'buttongroup')) {
    if (only.kind === 'confirm') {
      return (
        <Prim.Box style={{ display: 'flex', gap: 8 }}>
          <Prim.Pressable style={btnStyle(true)} onClick={() => onSubmit(true)}>Yes</Prim.Pressable>
          <Prim.Pressable style={btnStyle(false)} onClick={() => onSubmit(false)}>No</Prim.Pressable>
        </Prim.Box>
      );
    }
    return (
      <Prim.Box style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {only.options?.map((o, i) => <Prim.Pressable key={i} style={btnStyle(i === 0)} onClick={() => onSubmit(o.value)}>{o.label}</Prim.Pressable>)}
      </Prim.Box>
    );
  }

  return (
    <Prim.Box style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {spec.fields.map((f) => (
        <Prim.Text as="label" key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {f.label ? <Prim.Text style={{ fontSize: 12, color: 'var(--lm-text)' }}>{f.label}</Prim.Text> : null}
          <Control field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} onEnter={submit} />
          {f.help ? <Prim.Text style={{ fontSize: 10, color: 'var(--lm-muted)' }}>{f.help}</Prim.Text> : null}
          {f.error ? <Prim.Text style={{ fontSize: 10, color: 'var(--lm-red)' }}>{f.error}</Prim.Text> : null}
        </Prim.Text>
      ))}
      <Prim.Pressable style={{ ...btnStyle(true), alignSelf: 'flex-start' }} onClick={submit}>{spec.submitLabel}</Prim.Pressable>
    </Prim.Box>
  );
}

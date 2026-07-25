/**
 * Web renderer for the design-system form catalog. Given an `ask()` descriptor
 * (a bare control like `<Select/>` or a `<Form>` wrapper), it flattens the spec
 * via core's `flattenForm`, renders themed native controls, and submits a bare
 * value (single control) or an object keyed by field name (Form). Mirrors the
 * terminal `InkForm` so `ask(<Form>…</Form>)` behaves identically on both.
 */
import * as Prim from '../../../elements/primitives/index';
import React from 'react';
import { flattenForm, coerceValue, defaultFor } from '@lmthing/core/ui';
import type { FieldSpec } from '@lmthing/core/ui';

// `font: 'inherit'` used to sit here. It is REDUNDANT: preflight already declares
// `button, input, select, optgroup, textarea, ::file-selector-button { font: inherit }`
// (`@lmthing/css/preflight.css`), and every consumer of this bag is one of those tags. Verified in a
// browser rather than assumed — an `<input>`/`<textarea>`/`<select>` with and without the declaration
// compute identically across font-family/size/weight/style/variant/line-height/letter-spacing/stretch.
//
// It was also the ONE key blocking this bag from converting: `font` is a shorthand with no Tamagui
// prop form, so `style-bags-to-props.mjs` correctly refused the whole thing, and 16 call sites stayed
// on `style`.
const inputStyle = { backgroundColor: "var(--lm-bg)", color: "var(--lm-text)", borderWidth: "1px", borderStyle: "solid", borderColor: "var(--lm-border)", borderRadius: "var(--radius-lm-md, 6px)", paddingVertical: "4px", paddingHorizontal: "8px", outlineWidth: 0, outlineStyle: "none", width: "100%" } as const;

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
      return <Prim.TextArea {...inputStyle} minHeight={(field.rows ?? 3) * 20} value={String(value ?? '')} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'select': case 'combobox':
      return (
        <Prim.Select {...inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o, i) => <Prim.Option key={i} value={String(o.value)}>{o.label}</Prim.Option>)}
        </Prim.Select>
      );
    case 'multiselect': case 'checkboxgroup': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <Prim.Box display="flex" flexDirection="column" gap={2}>
          {field.options?.map((o, i) => (
            <Prim.Text as="label" key={i} display="flex" gap={6} cursor="pointer">
              <Prim.TextField type="checkbox" checked={arr.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((v) => v !== o.value))} />
              <Prim.Text>{o.label}</Prim.Text>
            </Prim.Text>
          ))}
        </Prim.Box>
      );
    }
    case 'radio':
      return (
        <Prim.Box display="flex" flexDirection="column" gap={2}>
          {field.options?.map((o, i) => (
            <Prim.Text as="label" key={i} display="flex" gap={6} cursor="pointer">
              <Prim.TextField type="radio" name={field.name} checked={value === o.value} onChange={() => onChange(o.value)} />
              <Prim.Text>{o.label}</Prim.Text>
            </Prim.Text>
          ))}
        </Prim.Box>
      );
    case 'checkbox': case 'switch':
      return <Prim.TextField type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'slider':
      return <Prim.TextField type="range" width="100%" min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />;
    case 'number': case 'stepper': case 'currency':
      return <Prim.TextField type="number" {...inputStyle} min={field.min} max={field.max} step={field.step} value={value === undefined || value === '' ? '' : Number(value)} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'rating': {
      const max = field.max ?? 5;
      const cur = Number(value ?? 0);
      return (
        <Prim.Box display="flex" gap={2}>
          {Array.from({ length: max }, (_, i) => (
            <Prim.Pressable key={i} onClick={() => onChange(i + 1)} backgroundColor="none" borderWidth={0} cursor="pointer" color={i < cur ? 'var(--lm-amber)' : 'var(--lm-muted)'} fontSize={16}>★</Prim.Pressable>
          ))}
        </Prim.Box>
      );
    }
    case 'date': return <Prim.TextField type="date" {...inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'time': return <Prim.TextField type="time" {...inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime': return <Prim.TextField type="datetime-local" {...inputStyle} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'color': return <Prim.TextField type="color" value={String(value || '#000000')} onChange={(e) => onChange(e.target.value)} />; // ds-lint-ok: default value for a native color picker, not a UI theme color
    case 'file': return <Prim.TextField type="text" {...inputStyle} placeholder={field.placeholder ?? 'path…'} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'taginput':
      return <Prim.TextField type="text" {...inputStyle} placeholder="comma,separated" value={Array.isArray(value) ? value.join(', ') : String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'password': return <Prim.TextField type="password" {...inputStyle} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'email': return <Prim.TextField type="email" {...inputStyle} placeholder={field.placeholder} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    case 'otp': return <Prim.TextField type="text" inputMode="numeric" {...inputStyle} letterSpacing={4} maxLength={field.length ?? 6} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Prim.TextField type="text" {...inputStyle} placeholder={field.placeholder} value={String(value ?? '')} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Tamagui PROP bag, not `CSSProperties` — every key here is a real style prop, so the buttons no
 *  longer need an inline `style`. Shorthands are expanded the way the codemod does it: `border` to
 *  the width/style/colour trio and `padding: '4px 12px'` to the vertical/horizontal pair.
 *  `font: 'inherit'` is DROPPED for the same reason it was dropped from `inputStyle` above —
 *  preflight already declares it for `button` (`@lmthing/css/preflight.css:107-108`). */
function btnProps(primary: boolean) {
  return {
    backgroundColor: primary ? 'color-mix(in srgb, var(--lm-accent) 20%, transparent)' : 'transparent',
    color: primary ? 'var(--lm-accent)' : 'var(--lm-text)',
    borderWidth: 1,
    borderStyle: 'solid' as const,
    borderColor: primary ? 'var(--lm-accent)' : 'var(--lm-border)',
    borderRadius: 'var(--radius-lm-md, 6px)',
    paddingVertical: '4px',
    paddingHorizontal: '12px',
    cursor: 'pointer',
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
        <Prim.Box display="flex" gap={8}>
          <Prim.Pressable {...btnProps(true)} onClick={() => onSubmit(true)}>Yes</Prim.Pressable>
          <Prim.Pressable {...btnProps(false)} onClick={() => onSubmit(false)}>No</Prim.Pressable>
        </Prim.Box>
      );
    }
    return (
      <Prim.Box display="flex" gap={8} flexWrap="wrap">
        {only.options?.map((o, i) => <Prim.Pressable key={i} {...btnProps(i === 0)} onClick={() => onSubmit(o.value)}>{o.label}</Prim.Pressable>)}
      </Prim.Box>
    );
  }

  return (
    <Prim.Box display="flex" flexDirection="column" gap={8}>
      {spec.fields.map((f) => (
        <Prim.Text as="label" key={f.name} display="flex" flexDirection="column" gap={2}>
          {f.label ? <Prim.Text fontSize={12} color="var(--lm-text)">{f.label}</Prim.Text> : null}
          <Control field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} onEnter={submit} />
          {f.help ? <Prim.Text fontSize={10} color="var(--lm-muted)">{f.help}</Prim.Text> : null}
          {f.error ? <Prim.Text fontSize={10} color="var(--lm-red)">{f.error}</Prim.Text> : null}
        </Prim.Text>
      ))}
      <Prim.Pressable {...btnProps(true)} alignSelf="flex-start" onClick={submit}>{spec.submitLabel}</Prim.Pressable>
    </Prim.Box>
  );
}

/**
 * Cross-platform form normalization. Both the web (`CatalogForm`) and terminal
 * (`InkForm`) renderers flatten an `ask()` form descriptor into a flat list of
 * `FieldSpec`s with the same semantics, then collect + coerce values the same
 * way — so `ask(<Form>…</Form>)` behaves identically on both surfaces.
 *
 * Browser-safe: no Node / no deps.
 */
import { CATALOG_BY_NAME } from './catalog.js';

export interface Option {
  label: string;
  value: unknown;
}

export type FieldKind =
  | 'text' | 'textarea' | 'number' | 'password' | 'email' | 'url' | 'search'
  | 'select' | 'multiselect' | 'combobox' | 'radio' | 'checkboxgroup'
  | 'checkbox' | 'switch' | 'slider' | 'stepper' | 'date' | 'time' | 'datetime'
  | 'color' | 'file' | 'taginput' | 'rating' | 'otp' | 'phone' | 'currency'
  | 'buttongroup' | 'confirm';

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  label?: string;
  help?: string;
  placeholder?: string;
  options?: Option[];
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  length?: number;
  currency?: string;
  error?: string;
}

export interface FormSpec {
  fields: FieldSpec[];
  submitLabel: string;
  /** True when the descriptor was a single bare control (resolve with the bare
   *  value); false when it was a multi-field <Form> (resolve with an object). */
  single: boolean;
}

interface Descriptor {
  type: string;
  props?: Record<string, unknown>;
  children?: unknown[];
}
function isDescriptor(v: unknown): v is Descriptor {
  return !!v && typeof v === 'object' && 'type' in (v as object);
}

/** Map a catalog form component name to a normalized field kind. */
const KIND_BY_TYPE: Record<string, FieldKind> = {
  textfield: 'text', textarea: 'textarea', numberfield: 'number',
  passwordfield: 'password', emailfield: 'email', urlfield: 'url',
  searchfield: 'search', select: 'select', dropdown: 'select',
  multiselect: 'multiselect', combobox: 'combobox', radiogroup: 'radio',
  checkboxgroup: 'checkboxgroup', checkbox: 'checkbox', switch: 'switch',
  slider: 'slider', stepper: 'stepper', datepicker: 'date',
  timepicker: 'time', datetimepicker: 'datetime', colorpicker: 'color',
  filefield: 'file', taginput: 'taginput', rating: 'rating',
  otpinput: 'otp', phonefield: 'phone', currencyfield: 'currency',
  buttongroup: 'buttongroup', confirmbuttons: 'confirm',
};

export function isFormDescriptor(d: unknown): boolean {
  if (!isDescriptor(d)) return false;
  const t = d.type.toLowerCase();
  return t === 'form' || t === 'fieldset' || t === 'field' || t in KIND_BY_TYPE;
}

/** Normalize `options` prop (string[] | {label,value}[]) into Option[]. */
export function normalizeOptions(raw: unknown): Option[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) =>
    o && typeof o === 'object' && 'value' in o
      ? { label: String((o as Option).label ?? (o as Option).value), value: (o as Option).value }
      : { label: String(o), value: o },
  );
}

let auto = 0;
function fieldFromDescriptor(d: Descriptor): FieldSpec | null {
  const t = d.type.toLowerCase();
  const kind = KIND_BY_TYPE[t];
  if (!kind) return null;
  const p = d.props ?? {};
  return {
    name: typeof p['name'] === 'string' ? (p['name'] as string) : `field${auto++}`,
    kind,
    label: p['label'] as string | undefined,
    help: p['help'] as string | undefined,
    placeholder: p['placeholder'] as string | undefined,
    options: normalizeOptions(p['options']),
    defaultValue: p['defaultValue'],
    min: p['min'] as number | undefined,
    max: p['max'] as number | undefined,
    step: p['step'] as number | undefined,
    rows: p['rows'] as number | undefined,
    length: p['length'] as number | undefined,
    currency: p['currency'] as string | undefined,
    error: p['error'] as string | undefined,
  };
}

/** Walk a Form/Fieldset/Field tree collecting leaf field controls. */
function collect(d: unknown, out: FieldSpec[]): void {
  if (Array.isArray(d)) { d.forEach((c) => collect(c, out)); return; }
  if (!isDescriptor(d)) return;
  const f = fieldFromDescriptor(d);
  if (f) {
    // A <Field label=…> wrapper contributes its label/help to the inner control.
    out.push(f);
    return;
  }
  // Container (Form/Fieldset/Field/other) — descend, merging Field label/help.
  const t = d.type.toLowerCase();
  if (t === 'field') {
    const before = out.length;
    collect(d.children, out);
    const p = d.props ?? {};
    for (let i = before; i < out.length; i++) {
      out[i]!.label = out[i]!.label ?? (p['label'] as string | undefined);
      out[i]!.help = out[i]!.help ?? (p['help'] as string | undefined);
      out[i]!.error = out[i]!.error ?? (p['error'] as string | undefined);
    }
    return;
  }
  collect(d.children, out);
}

/**
 * Flatten an ask() descriptor into a renderable form spec. A bare control
 * (e.g. `<Select/>`) yields a single-field spec; a `<Form>` yields the full
 * field list with object submission.
 */
export function flattenForm(descriptor: unknown): FormSpec {
  auto = 0;
  const fields: FieldSpec[] = [];
  collect(descriptor, fields);
  const top = isDescriptor(descriptor) ? descriptor.type.toLowerCase() : '';
  const isWrapper = top === 'form' || top === 'fieldset';
  const submitLabel =
    (isDescriptor(descriptor) && (descriptor.props?.['submitLabel'] as string)) || 'Submit';
  return { fields, submitLabel, single: !isWrapper && fields.length <= 1 };
}

/** Coerce a raw string/value from a control into the field's typed value. */
export function coerceValue(field: FieldSpec, raw: unknown): unknown {
  switch (field.kind) {
    case 'number': case 'slider': case 'stepper': case 'rating': case 'currency': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return Number.isNaN(n) ? undefined : n;
    }
    case 'checkbox': case 'switch': case 'confirm':
      return typeof raw === 'boolean' ? raw : /^(y|yes|true|on|1)$/i.test(String(raw).trim());
    case 'taginput':
      return Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    case 'multiselect': case 'checkboxgroup':
      return Array.isArray(raw) ? raw : [raw];
    default:
      return raw;
  }
}

/** Default value for a field before the user interacts. */
export function defaultFor(field: FieldSpec): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  switch (field.kind) {
    case 'checkbox': case 'switch': case 'confirm': return false;
    case 'multiselect': case 'checkboxgroup': case 'taginput': return [];
    case 'number': case 'slider': case 'stepper': case 'rating': return field.min ?? 0;
    case 'select': case 'radio': case 'combobox': case 'buttongroup':
      return field.options?.[0]?.value;
    default: return '';
  }
}

/** True if a descriptor type is one of the catalog's form components. */
export function isCatalogForm(typeName: string): boolean {
  return CATALOG_BY_NAME[typeName.toLowerCase()]?.kind === 'form';
}

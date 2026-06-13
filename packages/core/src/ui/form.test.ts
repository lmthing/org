import { describe, it, expect } from 'vitest';
import { flattenForm, normalizeOptions, coerceValue, defaultFor, isFormDescriptor, isCatalogForm } from './form.js';
import { CATALOG, CATALOG_NAMES, catalogDts, isFormComponent } from './catalog.js';

// Mimic the React-shim descriptor shape the VM produces from JSX.
const d = (type: string, props: Record<string, unknown> = {}, children: unknown[] = []) => ({ type, props, children });

describe('normalizeOptions', () => {
  it('accepts string[] and {label,value}[]', () => {
    expect(normalizeOptions(['a', 'b'])).toEqual([{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }]);
    expect(normalizeOptions([{ label: 'One', value: 1 }])).toEqual([{ label: 'One', value: 1 }]);
  });
  it('derives label from value when absent', () => {
    expect(normalizeOptions([{ value: 7 }])).toEqual([{ label: '7', value: 7 }]);
  });
  it('returns [] for non-arrays', () => {
    expect(normalizeOptions(undefined)).toEqual([]);
  });
});

describe('isFormDescriptor / isCatalogForm', () => {
  it('recognizes Form wrappers and bare controls', () => {
    expect(isFormDescriptor(d('Form'))).toBe(true);
    expect(isFormDescriptor(d('TextField'))).toBe(true);
    expect(isFormDescriptor(d('Select'))).toBe(true);
    expect(isFormDescriptor(d('Card'))).toBe(false);
    expect(isFormDescriptor('plain string')).toBe(false);
  });
  it('isCatalogForm matches form catalog only', () => {
    expect(isCatalogForm('select')).toBe(true);
    expect(isCatalogForm('Stack')).toBe(false);
  });
});

describe('flattenForm', () => {
  it('treats a bare control as a single-value form', () => {
    const spec = flattenForm(d('Select', { name: 'pick', options: ['x', 'y'] }));
    expect(spec.single).toBe(true);
    expect(spec.fields).toHaveLength(1);
    expect(spec.fields[0]!.kind).toBe('select');
    expect(spec.fields[0]!.options).toEqual([{ label: 'x', value: 'x' }, { label: 'y', value: 'y' }]);
  });

  it('flattens a Form with multiple fields into an object form', () => {
    const form = d('Form', { submitLabel: 'Go' }, [
      d('TextField', { name: 'title' }),
      d('Field', { label: 'Count', help: 'how many' }, [d('NumberField', { name: 'count' })]),
      d('Checkbox', { name: 'urgent' }),
    ]);
    const spec = flattenForm(form);
    expect(spec.single).toBe(false);
    expect(spec.submitLabel).toBe('Go');
    expect(spec.fields.map((f) => f.name)).toEqual(['title', 'count', 'urgent']);
    // Field wrapper label/help flow onto the inner control.
    const count = spec.fields.find((f) => f.name === 'count')!;
    expect(count.label).toBe('Count');
    expect(count.help).toBe('how many');
    expect(count.kind).toBe('number');
  });

  it('auto-names fields lacking a name', () => {
    const spec = flattenForm(d('Form', {}, [d('TextField'), d('TextField')]));
    expect(new Set(spec.fields.map((f) => f.name)).size).toBe(2);
  });
});

describe('coerceValue', () => {
  it('coerces numbers, booleans, arrays', () => {
    const num = { name: 'n', kind: 'number' as const };
    const chk = { name: 'c', kind: 'checkbox' as const };
    const tags = { name: 't', kind: 'taginput' as const };
    const ms = { name: 'm', kind: 'multiselect' as const };
    expect(coerceValue(num, '42')).toBe(42);
    expect(coerceValue(num, 'nope')).toBeUndefined();
    expect(coerceValue(chk, 'yes')).toBe(true);
    expect(coerceValue(chk, false)).toBe(false);
    expect(coerceValue(tags, 'a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(coerceValue(ms, 'one')).toEqual(['one']);
  });
});

describe('defaultFor', () => {
  it('uses defaultValue then kind-appropriate fallback', () => {
    expect(defaultFor({ name: 'x', kind: 'text', defaultValue: 'hi' })).toBe('hi');
    expect(defaultFor({ name: 'x', kind: 'checkbox' })).toBe(false);
    expect(defaultFor({ name: 'x', kind: 'multiselect' })).toEqual([]);
    expect(defaultFor({ name: 'x', kind: 'select', options: [{ label: 'a', value: 'a' }] })).toBe('a');
  });
});

describe('catalog', () => {
  it('exposes display + form components with unique names', () => {
    expect(CATALOG.length).toBeGreaterThan(50);
    expect(new Set(CATALOG_NAMES).size).toBe(CATALOG_NAMES.length);
    expect(isFormComponent('TextField')).toBe(true);
    expect(isFormComponent('Stack')).toBe(false);
  });
  it('generates valid-looking DTS declarations for every entry', () => {
    const dts = catalogDts();
    for (const name of CATALOG_NAMES) {
      expect(dts).toContain(`declare function ${name}(`);
    }
    expect(dts).toContain('): JSXDescriptor;');
  });
});

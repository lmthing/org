import { describe, it, expect } from 'vitest';
import {
  descriptorToText,
  isJsxDescriptor,
  isRenderableType,
  parseDescriptorPayload,
  sanitizeDescriptor,
} from './descriptor.js';
import { CATALOG_NAMES } from './catalog.js';

const d = (type: string, props: Record<string, unknown> = {}, children: unknown[] = []) =>
  ({ type, props, children });

describe('isRenderableType — the allowlist', () => {
  it('accepts every catalog component, in either case', () => {
    for (const name of CATALOG_NAMES) {
      expect(isRenderableType(name)).toBe(true);
      expect(isRenderableType(name.toLowerCase())).toBe(true);
    }
  });

  it('accepts the renderer aliases the model cannot write but the host emits', () => {
    for (const alias of ['fragment', 'h1', 'p', 'span', 'img', 'audio', 'checklist', 'plan', 'tasklist']) {
      expect(isRenderableType(alias)).toBe(true);
    }
  });

  it('rejects anything this product does not ship', () => {
    for (const bogus of ['script', 'iframe', 'MyWidget', 'div', '', null, 42]) {
      expect(isRenderableType(bogus)).toBe(false);
    }
  });
});

describe('parseDescriptorPayload — a descriptor that arrived as text', () => {
  it('recovers a descriptor serialized to JSON', () => {
    const json = JSON.stringify(d('Callout', { variant: 'success' }, ['done']));
    expect(parseDescriptorPayload(json)).toEqual(d('Callout', { variant: 'success' }, ['done']));
  });

  it('recovers an array of descriptors', () => {
    const json = JSON.stringify([d('Heading', {}, ['A']), d('Paragraph', {}, ['B'])]);
    expect(parseDescriptorPayload(json)).toHaveLength(2);
  });

  it('leaves ordinary prose alone, including markdown that starts with a brace', () => {
    expect(parseDescriptorPayload('Here is the answer: 42')).toBeNull();
    expect(parseDescriptorPayload('{ not json')).toBeNull();
    expect(parseDescriptorPayload('{"total":42}')).toBeNull();
    expect(parseDescriptorPayload('[1,2,3]')).toBeNull();
    expect(parseDescriptorPayload(undefined)).toBeNull();
  });
});

describe('sanitizeDescriptor — only allowed components survive', () => {
  it('passes a catalog tree through unchanged', () => {
    const tree = d('Stack', { gap: 2 }, [d('Heading', { level: 1 }, ['Report'])]);
    expect(sanitizeDescriptor(tree)).toEqual(tree);
  });

  it('unwraps an unknown component but keeps its content', () => {
    const tree = d('Stack', {}, [d('MyWidget', { danger: true }, ['inner text'])]);
    expect(sanitizeDescriptor(tree)).toEqual(d('Stack', {}, ['inner text']));
  });

  it('unwraps an unknown ROOT into the children that can render', () => {
    const tree = d('script', { src: 'x' }, [d('Paragraph', {}, ['still here'])]);
    expect(sanitizeDescriptor(tree)).toEqual(d('Paragraph', {}, ['still here']));
  });

  it('leaves nothing of an unknown component that carried no content', () => {
    expect(sanitizeDescriptor(d('iframe', { src: 'http://evil' }))).toEqual([]);
  });

  it('normalizes a descriptor with missing props/children', () => {
    expect(sanitizeDescriptor({ type: 'Spinner' })).toEqual(d('Spinner', {}, []));
  });

  it('does not rule on non-descriptor values — that is the renderer\'s call', () => {
    expect(sanitizeDescriptor({ total: 42 })).toEqual({ total: 42 });
    expect(sanitizeDescriptor('plain text')).toBe('plain text');
  });
});

describe('descriptorToText — the plain-text fallback', () => {
  it('reads content out of children', () => {
    const tree = d('Stack', {}, [d('Heading', {}, ['Report']), d('Paragraph', {}, ['All good.'])]);
    expect(descriptorToText(tree)).toBe('Report\nAll good.');
  });

  it('reads content out of props, which is where several components keep it', () => {
    expect(descriptorToText(d('Markdown', { text: '# Hi' }))).toBe('# Hi');
    expect(descriptorToText(d('Card', { title: 'Totals' }, ['body']))).toBe('Totals\nbody');
    expect(descriptorToText(d('List', { items: ['a', 'b'] }))).toBe('a\nb');
    expect(descriptorToText(d('KeyValue', { pairs: { Status: 'active' } }))).toBe('Status: active');
  });

  it('renders a checklist plan as marked lines, not empty', () => {
    const plan = d('checklist', {
      title: 'Plan',
      items: [
        { content: 'done step', status: 'completed' },
        { content: 'active step', status: 'in_progress' },
        { content: 'todo step', status: 'pending' },
        { content: 'broke step', status: 'failed' },
      ],
    });
    expect(descriptorToText(plan)).toBe('Plan\n[x] done step\n[~] active step\n[ ] todo step\n[✗] broke step');
  });

  it('flattens a table to readable rows', () => {
    const table = d('Table', { columns: ['Name', 'Score'], rows: [['alpha', 10]] });
    expect(descriptorToText(table)).toBe('Name | Score\nalpha | 10');
  });

  it('is empty for a value with nothing to say, rather than JSON', () => {
    expect(descriptorToText(d('Spinner'))).toBe('');
    expect(descriptorToText({ total: 42 })).toBe('');
  });
});

describe('isJsxDescriptor', () => {
  it('is the shape the VM shim produces, not any object with a `type` key', () => {
    expect(isJsxDescriptor(d('Text'))).toBe(true);
    expect(isJsxDescriptor({ type: 'Text' })).toBe(true);
    expect(isJsxDescriptor({ type: 7 })).toBe(false);
    expect(isJsxDescriptor([d('Text')])).toBe(false);
    expect(isJsxDescriptor(null)).toBe(false);
  });
});

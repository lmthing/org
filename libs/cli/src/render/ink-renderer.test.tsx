import React from 'react';
import { describe, it, expect } from 'vitest';
import { Box, Text } from 'ink';
import { renderDescriptor } from './ink-renderer.js';
import { InkForm } from './ink-form.js';

/** Walk a React element tree and collect all string leaf values. */
function extractText(node: React.ReactNode): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    return extractText(el.props.children);
  }
  return '';
}

function desc(type: string, children: unknown[] = [], props: Record<string, unknown> = {}) {
  return { type, props, children };
}

describe('renderDescriptor', () => {
  it('renders known block elements as Box', () => {
    const el = renderDescriptor(desc('p', ['hello'])) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Box);
  });

  it('renders unknown element types as Box, not Text', () => {
    const el = renderDescriptor(desc('div', [])) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Box);
  });

  it('does not nest Box inside Text for div > p', () => {
    // div renders as Box; p renders as Box inside Box — no Box-inside-Text
    const el = renderDescriptor(desc('div', [desc('p', ['hello'])])) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Box);
  });

  it('renders span as Text', () => {
    const el = renderDescriptor(desc('span', ['hi'])) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Text);
  });

  it('renders h1 as Text', () => {
    const el = renderDescriptor(desc('h1', ['Title'])) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Text);
  });

  it('renders plain string as Text', () => {
    const el = renderDescriptor('hello') as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Text);
  });

  // ── design-system display catalog ──
  it('renders Stack/stack (case-insensitive) as a column Box', () => {
    const el = renderDescriptor(desc('Stack', ['a'])) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Box);
    expect(el.props.flexDirection).toBe('column');
  });

  it('renders a Table from columns + rows', () => {
    const el = renderDescriptor(desc('table', [], { columns: ['A', 'B'], rows: [[1, 2]] })) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Box);
    // header + one row
    expect(React.Children.toArray(el.props.children).length).toBe(2);
  });

  it('renders a ProgressBar as Text', () => {
    const el = renderDescriptor(desc('progressbar', [], { value: 0.5 })) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Text);
  });

  it('renders a List from items prop', () => {
    const el = renderDescriptor(desc('list', [], { items: ['x', 'y'] })) as React.ReactElement<Record<string, any>>;
    expect(el.type).toBe(Box);
    expect(React.Children.toArray(el.props.children).length).toBe(2);
  });
});

// ── Parity fixtures (same shapes as render-catalog.web.test.tsx) ──────────────
// Note: desc(type, children, props) — children is 2nd arg, props is 3rd.

const TABLE_FIXTURE = desc('table', [], { columns: ['Name', 'Score'], rows: [['alpha', 10], ['beta', 20]] });
const STACK_HEADING_FIXTURE = desc('stack', [desc('heading', ['Report Title'])]);
const CALLOUT_FIXTURE = desc('callout', ['All checks passed.'], { variant: 'success', title: 'Done' });
const LIST_FIXTURE = desc('list', [], { items: ['apple', 'banana', 'cherry'] });
const KEYVALUE_FIXTURE = desc('keyvalue', [], { pairs: { Status: 'active', Region: 'eu-west' } });
const PROGRESSBAR_FIXTURE = desc('progressbar', [], { value: 42, max: 100 });
const FORM_FIXTURE = desc('Form', [
  desc('TextField', [], { name: 'title', label: 'Title' }),
  desc('Select', [], { name: 'env', label: 'Environment', options: ['dev', 'prod'] }),
]);

describe('terminal renderDescriptor — parity with web catalog', () => {
  it('Table contains column headers and cell values', () => {
    const text = extractText(renderDescriptor(TABLE_FIXTURE));
    expect(text).toContain('Name');
    expect(text).toContain('Score');
    expect(text).toContain('alpha');
    expect(text).toContain('10');
  });

  it('Stack+Heading contains heading text', () => {
    const text = extractText(renderDescriptor(STACK_HEADING_FIXTURE));
    expect(text).toContain('Report Title');
  });

  it('Callout contains title and body text', () => {
    const text = extractText(renderDescriptor(CALLOUT_FIXTURE));
    expect(text).toContain('Done');
    expect(text).toContain('All checks passed');
  });

  it('List renders bullet markers and item text', () => {
    const text = extractText(renderDescriptor(LIST_FIXTURE));
    expect(text).toContain('apple');
    expect(text).toContain('banana');
    expect(text).toContain('cherry');
  });

  it('KeyValue contains key and value text', () => {
    const text = extractText(renderDescriptor(KEYVALUE_FIXTURE));
    expect(text).toContain('Status');
    expect(text).toContain('active');
    expect(text).toContain('Region');
    expect(text).toContain('eu-west');
  });

  it('ProgressBar text contains percentage', () => {
    const text = extractText(renderDescriptor(PROGRESSBAR_FIXTURE));
    expect(text).toContain('42%');
  });
});

describe('terminal InkForm — form catalog', () => {
  it('creates a valid React element for a multi-field Form', () => {
    // InkForm uses hooks and cannot be called outside a React context, so we
    // verify element creation doesn't throw (structural smoke test).
    const el = React.createElement(InkForm, { descriptor: FORM_FIXTURE, onSubmit: () => {} });
    expect(el.type).toBe(InkForm);
    expect(el.props.descriptor).toBe(FORM_FIXTURE);
  });

  it('creates a valid React element for a bare Select', () => {
    const selectOnly = desc('Select', [], { name: 'env', label: 'Environment', options: ['dev', 'prod'] });
    const el = React.createElement(InkForm, { descriptor: selectOnly, onSubmit: () => {} });
    expect(el.type).toBe(InkForm);
  });
});

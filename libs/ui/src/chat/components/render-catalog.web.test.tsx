/**
 * Token-cheap cross-platform render test — web surface.
 *
 * Renders each fixture through the real primitives and asserts on the DOM it
 * mounts. No esbuild bundle, no browser, no full app. The same fixture shapes
 * are mirrored in ink-renderer.test.tsx (terminal) to prove both surfaces agree
 * on the same catalog vocabulary.
 *
 * It renders through `test-utils`' provider-wrapped `render`, not
 * `renderToStaticMarkup`: post-Tamagui every primitive calls `useTheme()` and
 * throws `Missing theme.` outside a provider. That, plus a `.tsx` extension the
 * vitest include did not match, is why this suite ran NOWHERE and its
 * assertions on `flex-col` / `border-l-2` — Tailwind classes deleted in the
 * migration — went stale unnoticed.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '../../test-utils/index';
import { renderDescriptor } from './render-descriptor';
import { CatalogForm } from './forms/CatalogForm';

const d = (type: string, props: Record<string, unknown> = {}, children: unknown[] = []) =>
  ({ type, props, children });

// ── Shared fixtures (same shapes as ink-renderer.test.tsx) ───────────────────

const TABLE_FIXTURE = d('table', {
  columns: ['Name', 'Score'],
  rows: [['alpha', 10], ['beta', 20]],
});

const STACK_HEADING_FIXTURE = d('stack', {}, [
  d('heading', {}, ['Report Title']),
]);

const CALLOUT_FIXTURE = d('callout', { variant: 'success', title: 'Done' }, ['All checks passed.']);

const LIST_FIXTURE = d('list', { items: ['apple', 'banana', 'cherry'] });

const KEYVALUE_FIXTURE = d('keyvalue', { pairs: { Status: 'active', Region: 'eu-west' } });

const PROGRESSBAR_FIXTURE = d('progressbar', { value: 42, max: 100 });

const FORM_FIXTURE = d('Form', {}, [
  d('TextField', { name: 'title', label: 'Title' }),
  d('Select', { name: 'env', label: 'Environment', options: ['dev', 'prod'] }),
]);

// ─────────────────────────────────────────────────────────────────────────────

function html(node: React.ReactNode): string {
  return render(<>{node}</>).container.innerHTML;
}

describe('web renderDescriptor — display catalog', () => {
  it('Table renders a <table> with column headers and cell values', () => {
    const out = html(renderDescriptor(TABLE_FIXTURE));
    expect(out).toContain('<table');
    expect(out).toContain('Name');
    expect(out).toContain('Score');
    expect(out).toContain('alpha');
    expect(out).toContain('10');
  });

  it('Stack renders a column container with child content', () => {
    const { container, getByText } = render(<>{renderDescriptor(STACK_HEADING_FIXTURE)}</>);
    expect(getByText('Report Title')).toBeTruthy();
    // A Stack is a column: the atomic class is the post-Tailwind spelling of `flex-col`.
    expect(container.innerHTML).toContain('_fd-column');
  });

  it('Callout renders its title and body under a variant accent', () => {
    const { container, getByText } = render(<>{renderDescriptor(CALLOUT_FIXTURE)}</>);
    expect(getByText('Done')).toBeTruthy();
    expect(getByText('All checks passed.')).toBeTruthy();
    // `variant="success"` picks the green accent; a raw color literal would be a token violation.
    expect(container.innerHTML).toContain('lm-green');
  });

  it('List renders a <ul> with an <li> for each item', () => {
    const { container, getAllByRole } = render(<>{renderDescriptor(LIST_FIXTURE)}</>);
    expect(container.innerHTML).toContain('<ul');
    expect(getAllByRole('listitem').map((li) => li.textContent)).toEqual(['apple', 'banana', 'cherry']);
  });

  it('KeyValue renders a <dl> with key and value text', () => {
    const out = html(renderDescriptor(KEYVALUE_FIXTURE));
    expect(out).toContain('<dl');
    expect(out).toContain('Status');
    expect(out).toContain('active');
    expect(out).toContain('Region');
    expect(out).toContain('eu-west');
  });

  it('ProgressBar sizes its fill from the value', () => {
    // Post-Tamagui the width is an atomic class, not an inline `width:42%`, so
    // the proof is that a different value produces a different fill.
    const at42 = html(renderDescriptor(PROGRESSBAR_FIXTURE));
    const at90 = html(renderDescriptor(d('progressbar', { value: 90, max: 100 })));
    expect(at42).not.toBe(at90);
  });
});

describe('web CatalogForm — form catalog', () => {
  it('renders TextField with label and input element', () => {
    const out = html(<CatalogForm descriptor={FORM_FIXTURE} onSubmit={() => {}} />);
    expect(out).toContain('Title');
    expect(out).toContain('<input');
    expect(out).toContain('Environment');
    expect(out).toContain('<select');
    expect(out).toContain('dev');
    expect(out).toContain('prod');
  });

  it('renders a submit button', () => {
    const { getByText } = render(<CatalogForm descriptor={FORM_FIXTURE} onSubmit={() => {}} />);
    expect(getByText('Submit')).toBeTruthy();
  });
});

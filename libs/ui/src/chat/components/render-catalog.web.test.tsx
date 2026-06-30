/**
 * Token-cheap cross-platform render test — web surface.
 *
 * Uses renderToStaticMarkup (react-dom/server) to render each fixture to a small
 * HTML string and asserts on its structure. No esbuild bundle, no browser, no
 * full app. The same fixture shapes are mirrored in ink-renderer.test.tsx (terminal)
 * to prove both surfaces agree on the same catalog vocabulary.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { renderDescriptor } from './render-descriptor.js';
import { CatalogForm } from './forms/CatalogForm.js';

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

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

describe('web renderDescriptor — display catalog', () => {
  it('Table renders a <table> with column headers and cell values', () => {
    const html = render(renderDescriptor(TABLE_FIXTURE));
    expect(html).toContain('<table');
    expect(html).toContain('Name');
    expect(html).toContain('Score');
    expect(html).toContain('alpha');
    expect(html).toContain('10');
  });

  it('Stack renders a flex-col div with child content', () => {
    const html = render(renderDescriptor(STACK_HEADING_FIXTURE));
    expect(html).toContain('flex-col');
    expect(html).toContain('Report Title');
  });

  it('Callout renders a bordered div with variant class and title', () => {
    const html = render(renderDescriptor(CALLOUT_FIXTURE));
    expect(html).toContain('border-l-2');
    expect(html).toContain('Done');
    expect(html).toContain('All checks passed');
  });

  it('List renders a <ul> with <li> for each item', () => {
    const html = render(renderDescriptor(LIST_FIXTURE));
    expect(html).toContain('<ul');
    expect(html).toContain('<li>apple</li>');
    expect(html).toContain('<li>banana</li>');
    expect(html).toContain('<li>cherry</li>');
  });

  it('KeyValue renders a <dl> with key and value text', () => {
    const html = render(renderDescriptor(KEYVALUE_FIXTURE));
    expect(html).toContain('<dl');
    expect(html).toContain('Status');
    expect(html).toContain('active');
    expect(html).toContain('Region');
    expect(html).toContain('eu-west');
  });

  it('ProgressBar renders an inner div with percentage width', () => {
    const html = render(renderDescriptor(PROGRESSBAR_FIXTURE));
    expect(html).toContain('width:42%');
  });
});

describe('web CatalogForm — form catalog', () => {
  it('renders TextField with label and input element', () => {
    const html = renderToStaticMarkup(
      <CatalogForm descriptor={FORM_FIXTURE} onSubmit={() => {}} />,
    );
    expect(html).toContain('Title');
    expect(html).toContain('<input');
    expect(html).toContain('Environment');
    expect(html).toContain('<select');
    expect(html).toContain('dev');
    expect(html).toContain('prod');
  });

  it('renders a submit button', () => {
    const html = renderToStaticMarkup(
      <CatalogForm descriptor={FORM_FIXTURE} onSubmit={() => {}} />,
    );
    expect(html).toContain('Submit');
    expect(html).toContain('<button');
  });
});

/**
 * What a surface does with a descriptor it was NOT designed for.
 *
 * Every renderer here used to answer that question by printing the descriptor at
 * the reader — `renderDescriptor` fell through to a monospace `type: {…props}`
 * line, and `DisplayBlock` carried its own short switch and `JSON.stringify`d
 * the rest. That is the "THING replies with JSON" bug, and it is a rendering
 * bug, so this is where it is pinned.
 *
 * The native half is `metro/suites/descriptor.tsx`: jsdom cannot see the React
 * Native target, so a green suite here says nothing about a phone.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '../../test-utils/index';
import { renderDescriptor, toRenderableDescriptor } from './render-descriptor';
import { DisplayBlock } from './DisplayBlock';

const d = (type: string, props: Record<string, unknown> = {}, children: unknown[] = []) =>
  ({ type, props, children });

const html = (node: React.ReactNode): string => render(<>{node}</>).container.innerHTML;

describe('renderDescriptor — only allowed components render', () => {
  it('never prints a descriptor at the reader, whatever the type', () => {
    const out = html(renderDescriptor(d('MyWidget', { secret: 'value' }, ['the answer'])));
    expect(out).not.toContain('MyWidget');
    expect(out).not.toContain('secret');
    // The content inside survives — losing the box is fine, losing the sentence is not.
    expect(out).toContain('the answer');
  });

  it('keeps rendering the allowed components nested inside an unknown one', () => {
    const out = html(renderDescriptor(d('Unknown', {}, [d('Table', { columns: ['Name'], rows: [['alpha']] })])));
    expect(out).toContain('<table');
    expect(out).toContain('alpha');
  });

  it('renders a heading level from the tag when the descriptor did not say', () => {
    expect(html(renderDescriptor(d('h4', {}, ['Small'])))).toContain('<h4');
  });

  it('renders a form control put in a display() as its content, not its prop bag', () => {
    // `<TextField>` is an allowed component, but a display has nothing to submit
    // to, so it has no case of its own. Show the content; never the props.
    const out = html(renderDescriptor(d('TextField', { name: 'title', placeholder: 'a title' }, ['Title'])));
    expect(out).not.toContain('placeholder');
    expect(out).toContain('Title');
  });
});

describe('toRenderableDescriptor — a descriptor that arrived as text', () => {
  it('recovers a descriptor from its JSON', () => {
    expect(toRenderableDescriptor(JSON.stringify(d('Callout', {}, ['hi'])))).toEqual(d('Callout', {}, ['hi']));
  });

  it('leaves prose alone so it stays markdown', () => {
    expect(toRenderableDescriptor('# A heading, not a descriptor')).toBeNull();
    expect(toRenderableDescriptor('')).toBeNull();
  });
});

describe('DisplayBlock — one renderer, not a second smaller one', () => {
  // Every case below rendered as an empty or contentless box before `DisplayBlock`
  // delegated: `Table`/`KeyValue`/`List` keep their content in PROPS, and the old
  // private switch only ever rendered children.
  it('renders a Table with its columns and cells', () => {
    const out = html(<DisplayBlock descriptor={d('Table', { columns: ['Name', 'Score'], rows: [['alpha', 10]] })} />);
    expect(out).toContain('<table');
    expect(out).toContain('Name');
    expect(out).toContain('alpha');
  });

  it('renders a KeyValue as a definition list', () => {
    const out = html(<DisplayBlock descriptor={d('KeyValue', { pairs: { Status: 'active' } })} />);
    expect(out).toContain('<dl');
    expect(out).toContain('Status');
    expect(out).toContain('active');
  });

  it('renders a List built from `items`', () => {
    const out = html(<DisplayBlock descriptor={d('List', { items: ['apple', 'banana'] })} />);
    expect(out).toContain('<li');
    expect(out).toContain('apple');
    expect(out).toContain('banana');
  });

  it('renders a Stack of children rather than flattening them into a span', () => {
    const out = html(<DisplayBlock descriptor={d('Stack', {}, [d('Heading', {}, ['Report']), d('Paragraph', {}, ['Body'])])} />);
    expect(out).toContain('Report');
    expect(out).toContain('Body');
  });

  it('renders a string display as markdown, the way the transcript does', () => {
    expect(html(<DisplayBlock descriptor={'# Title'} />)).toContain('<h1');
  });

  it('renders a descriptor that arrived as a JSON string as components', () => {
    const out = html(<DisplayBlock descriptor={JSON.stringify(d('Callout', { variant: 'success', title: 'Done' }, ['All good']))} />);
    expect(out).toContain('All good');
    expect(out).toContain('Done');
    expect(out).not.toContain('"type"');
  });
});

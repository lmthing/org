/**
 * The `markdown` descriptor — an agent's `<Markdown text="…"/>` reaching the
 * transcript.
 *
 * These assertions used to read `result.props.dangerouslySetInnerHTML.__html`,
 * which stopped existing when the markdown renderer became token-based (it
 * mounts elements now, so it works with no DOM at all — see
 * `elements/content/markdown`). Nothing caught the drift because the suite is a
 * `.tsx` and the vitest include only matched `.ts` under `chat/`. It asserts on
 * what is mounted now.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '../../test-utils/index';
import { renderDescriptor } from './render-descriptor';

const markdownBlock = (props: Record<string, unknown>, children: unknown[] = []) =>
  renderDescriptor({ type: 'markdown', props, children });

const html = (node: React.ReactNode): string => render(<>{node}</>).container.innerHTML;

describe('renderDescriptor - Markdown component', () => {
  it('renders markdown text as elements', () => {
    const out = html(markdownBlock({ text: '# Heading\nThis is **bold** text and *italic* text.' }));
    expect(out).toContain('<h1');
    expect(out).toContain('Heading');
    expect(out).toContain('<strong');
    expect(out).toContain('bold');
    expect(out).toContain('<em');
    expect(out).toContain('italic');
  });

  it('renders markdown from children when there is no `text` prop', () => {
    const out = html(markdownBlock({}, ['# Title\n\nContent here']));
    expect(out).toContain('<h1');
    expect(out).toContain('Title');
    expect(out).toContain('Content here');
  });

  it('renders a fenced code block', () => {
    const { getByText } = render(<>{markdownBlock({ text: '```js\nconsole.log("hello")\n```' })}</>);
    expect(getByText('console.log("hello")')).toBeTruthy();
  });

  it('renders a link with its href', () => {
    const out = html(markdownBlock({ text: '[Click here](https://example.com)' }));
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('Click here');
  });
});

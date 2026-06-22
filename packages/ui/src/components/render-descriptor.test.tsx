import { describe, it, expect } from 'vitest';
import { renderDescriptor } from './render-descriptor.js';

describe('renderDescriptor - Markdown component', () => {
  it('renders markdown text as HTML', () => {
    const markdown = `# Heading
This is **bold** text and *italic* text.`;

    const descriptor = {
      type: 'markdown',
      props: { text: markdown },
      children: [],
    };

    const result = renderDescriptor(descriptor);
    const html = (result as any)?.props?.dangerouslySetInnerHTML?.__html;

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders markdown from children', () => {
    const descriptor = {
      type: 'markdown',
      props: {},
      children: ['# Title\n\nContent here'],
    };

    const result = renderDescriptor(descriptor);
    const html = (result as any)?.props?.dangerouslySetInnerHTML?.__html;

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Content here</p>');
  });

  it('renders code blocks in markdown', () => {
    const descriptor = {
      type: 'markdown',
      props: { text: '```js\nconsole.log("hello")\n```' },
      children: [],
    };

    const result = renderDescriptor(descriptor);
    const html = (result as any)?.props?.dangerouslySetInnerHTML?.__html;

    expect(html).toContain('<code class="language-js"');
    expect(html).toContain('console.log');
  });

  it('renders markdown with links', () => {
    const descriptor = {
      type: 'markdown',
      props: { text: '[Click here](https://example.com)' },
      children: [],
    };

    const result = renderDescriptor(descriptor);
    const html = (result as any)?.props?.dangerouslySetInnerHTML?.__html;

    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('Click here');
  });
});

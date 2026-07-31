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

/**
 * `--lm-*` regression guard.
 *
 * `renderDescriptor` used to colour every descriptor with `var(--lm-<name>)`, an alias that only
 * `app/styles.css` (a web-only stylesheet the `/chat` ROUTE loads) resolves. React Native never
 * loads that file — its primitive layer rewrites any `var(--x)` straight to the Tamagui token `$x`
 * with no knowledge of the bridge, so `var(--lm-text)` became the nonexistent token `$lm-text` and
 * the colour silently vanished on a phone, in the renderer for EVERY `display()` call, the /chat
 * transcript and the team channels alike.
 *
 * jsdom cannot see the native target (only `pnpm test:native` can — see `libs/ui/metro/README.md`),
 * so this cannot assert the colour actually renders on a device. What it CAN prove, and what would
 * have caught the original bug, is that no `--lm-*` alias is reachable from the renderer at all: on
 * web, Tamagui's atomic CSS turns a `var(--lm-text)` colour prop into a class name carrying that
 * exact string (`_col-lm-text`), so its absence here is a real, mechanical guarantee that every
 * call site was moved onto a token that is registered on BOTH targets.
 */
describe('renderDescriptor — no --lm-* aliases reach a rendered colour', () => {
  const cases: Array<[string, unknown]> = [
    ['heading', { type: 'h1', props: {}, children: ['Title'] }],
    ['text with a named color prop', { type: 'text', props: { color: 'red' }, children: ['warn'] }], // ds-lint-ok — the colour under test is the AGENT's, not ours
    ['text with dim', { type: 'text', props: { dim: true }, children: ['dim'] }],
    ['muted', { type: 'muted', props: {}, children: ['muted'] }],
    ['kbd', { type: 'kbd', props: {}, children: ['Ctrl'] }],
    ['code', { type: 'code', props: {}, children: ['x'] }],
    ['codeblock', { type: 'codeblock', props: { lang: 'ts' }, children: ['const x = 1;'] }],
    ['quote', { type: 'quote', props: {}, children: ['quoted'] }],
    ['link', { type: 'link', props: { href: 'https://example.com' }, children: ['click'] }],
    ['divider', { type: 'divider', props: { label: 'section' } }],
    ['card', { type: 'card', props: { title: 'T' }, children: ['body'] }],
    ['callout error', { type: 'callout', props: { variant: 'error', title: 'Oops' }, children: ['bad'] }],
    ['callout success', { type: 'callout', props: { variant: 'success', title: 'Done' }, children: ['ok'] }],
    ['badge with a named color', { type: 'badge', props: { color: 'purple' }, children: ['tag'] }], // ds-lint-ok
    ['badge with an unmapped color', { type: 'badge', props: { color: 'crimson' }, children: ['tag'] }], // ds-lint-ok
    ['list', { type: 'list', props: { items: ['a', 'b'] } }],
    ['table', { type: 'table', props: { columns: ['A'], rows: [[1]] } }],
    ['keyvalue', { type: 'keyvalue', props: { pairs: { k: 'v' } } }],
    ['timeline', { type: 'timeline', props: { items: [{ title: 't', time: '1s', detail: 'd' }] } }],
    ['progressbar', { type: 'progressbar', props: { value: 40, label: 'loading' } }],
    ['spinner', { type: 'spinner', props: { label: 'working' } }],
    ['statcard', { type: 'statcard', props: { label: 'L', value: 'V', delta: '+1' } }],
    ['details', { type: 'details', props: { summary: 'more' }, children: ['hidden'] }],
    ['not-a-descriptor fallback', { some: 'raw', object: true }],
  ];

  it.each(cases)('%s carries no --lm-* / lm- alias in its rendered output', (_label, descriptor) => {
    const out = html(renderDescriptor(descriptor));
    expect(out).not.toMatch(/lm-(text|muted|accent|green|red|amber|purple|cyan|bg|panel)\b/);
  });
});

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

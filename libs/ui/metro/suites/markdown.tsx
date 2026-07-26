/**
 * Markdown, RENDERED on the React Native target.
 *
 * This is the suite that justifies the token renderer existing. The previous implementation was
 * `marked.parse(source)` handed to `dangerouslySetInnerHTML`, and on native that produced **an
 * empty box** — the native primitives drop the prop deliberately, so the most user-visible thing in
 * the product rendered nothing at all and no test anywhere could see it. Every assertion below
 * would have failed against the old implementation.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, findByText, hostTypes, flattenStyle, styleOf, NATIVE_TEXT, NATIVE_VIEW } from '../render'
import { Markdown } from '../../src/elements/content/markdown'

const SAMPLE = [
  '# Heading',
  '',
  'A paragraph with **bold** and `code`.',
  '',
  '- first',
  '- second',
  '',
  '> quoted',
  '',
  '```ts',
  'const x = 1',
  '```',
].join('\n')

test('markdown mounts real native text, not an empty box', () => {
  const { tree } = render(<Markdown source={SAMPLE} />)
  const texts = hostTypes(tree).filter((t) => t === NATIVE_TEXT)
  // The old innerHTML path mounted a single view with no children on this target.
  expect(texts.length > 0).toBe(true)
  expect(findByText(tree, 'Heading')).toBeTruthy()
})

test('inline tokens survive as separate native text nodes', () => {
  const { tree } = render(<Markdown source={'plain **bold** tail'} />)
  expect(findByText(tree, 'bold')).toBeTruthy()
  expect(findByText(tree, 'plain ')).toBeTruthy()
})

test('a list renders one node per item', () => {
  const { tree } = render(<Markdown source={'- alpha\n- beta\n- gamma'} />)
  expect(findByText(tree, 'alpha')).toBeTruthy()
  expect(findByText(tree, 'beta')).toBeTruthy()
  expect(findByText(tree, 'gamma')).toBeTruthy()
})

test('a fenced code block keeps its source and takes the mono face', () => {
  const { tree } = render(<Markdown source={'```ts\nconst x = 1\n```'} />)
  const code = findByText(tree, 'const x = 1')
  expect(code).toBeTruthy()
  // `Prim.Pre` is a host passthrough that ignores style props, which is why the renderer uses
  // `Text as="pre"`. If that regressed, the preset would style nothing and this would be undefined.
  expect(typeof flattenStyle(code?.props?.style).fontFamily).toBe('string')
})

test('the two presets are not the same scale', () => {
  // `.lm-markdown` and `.lm-prose` were deliberately different, and merging them would move the
  // chat transcript's layout. The container line-height is the cheapest proof they stayed apart.
  // Read a TEXT node, not the container: RN has no cascade, so the container carries no typography
  // at all — which is exactly what this assertion caught when it did.
  const lineHeightOf = (preset: 'document' | 'prose') =>
    flattenStyle(findByText(render(<Markdown source={'x'} preset={preset} />).tree, 'x')?.props?.style).lineHeight
  expect(lineHeightOf('document') === lineHeightOf('prose')).toBe(false)
})

test('raw html is shown as text, never interpreted', () => {
  const { tree } = render(<Markdown source={'<div class="raw">danger</div>'} />)
  // Shown rather than dropped: model output does not silently disappear. Shown rather than
  // interpreted: there is no DOM here, and injecting is what could not work in the first place.
  const nodes = findAll(tree, () => true)
  const text = nodes.map((n) => (Array.isArray(n.children) ? n.children.join('') : '')).join('')
  expect(text.includes('<div')).toBe(true)
})

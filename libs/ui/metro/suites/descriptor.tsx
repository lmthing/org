/**
 * An agent's JSX answer, RENDERED on the React Native target.
 *
 * `renderDescriptor` is the single renderer for everything `display()` produces
 * — the `/chat` transcript, the connected-session `DisplayBlock`, and the team
 * channels all draw through it. "It works on mobile" is therefore a claim about
 * this function and nothing else, and jsdom structurally cannot check it:
 * `isWeb` is always true there, so a web-only host tag or a prop the native
 * primitives drop looks fine right up until a device mounts an empty box.
 *
 * The prop-carrying components are the ones worth the tokens. `Table`,
 * `KeyValue`, `List` and `ProgressBar` keep their whole content in PROPS, so a
 * renderer that only walks children mounts nothing at all for them — the exact
 * failure the markdown suite next door was written for, in a different file.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, findByText, hostTypes, flattenStyle, NATIVE_TEXT } from '../render'
import { renderDescriptor } from '../../src/chat/components/render-descriptor'

const d = (type: string, props: Record<string, unknown> = {}, children: unknown[] = []) =>
  ({ type, props, children })

const draw = (descriptor: unknown) => render(<>{renderDescriptor(descriptor)}</>)

test('a Stack of headings and paragraphs mounts real native text', () => {
  const { tree } = draw(d('Stack', {}, [
    d('Heading', { level: 1 }, ['Weekly report']),
    d('Paragraph', {}, ['Everything is fine.']),
  ]))
  expect(hostTypes(tree).filter((t) => t === NATIVE_TEXT).length > 0).toBe(true)
  expect(findByText(tree, 'Weekly report')).toBeTruthy()
  expect(findByText(tree, 'Everything is fine.')).toBeTruthy()
})

test('a Table mounts its headers and cells — its content lives in props, not children', () => {
  const { tree } = draw(d('Table', { columns: ['Name', 'Score'], rows: [['alpha', 10], ['beta', 20]] }))
  for (const cell of ['Name', 'Score', 'alpha', 'beta']) {
    const node = findByText(tree, cell)
    expect(node).toBeTruthy()
    // React Native refuses a bare string inside a View, so asserting the host
    // TYPE is what proves the cell would actually appear on a device.
    expect(node?.type).toBe(NATIVE_TEXT)
  }
})

test('a List built from `items` mounts one text node per item', () => {
  const { tree } = draw(d('List', { items: ['apple', 'banana', 'cherry'] }))
  for (const item of ['apple', 'banana', 'cherry']) {
    expect(findByText(tree, item)?.type).toBe(NATIVE_TEXT)
  }
})

test('a KeyValue mounts both halves of every pair', () => {
  const { tree } = draw(d('KeyValue', { pairs: { Status: 'active', Region: 'eu-west' } }))
  for (const word of ['Status', 'active', 'Region', 'eu-west']) {
    expect(findByText(tree, word)?.type).toBe(NATIVE_TEXT)
  }
})

test('a Heading mounts a native text node, never a raw <h1> host tag', () => {
  const { tree } = draw(d('Heading', { level: 1 }, ['Title']))
  // The web spelling was `<h1 className="text-lg …">`. React Native has no view
  // config for `h1`, so mounting it throws on a device; and the className was
  // Tailwind, deleted in the migration, so it styled nothing on web either.
  expect(hostTypes(tree).some((t) => /^h[1-6]$/.test(t))).toBe(false)
  expect(findByText(tree, 'Title')?.type).toBe(NATIVE_TEXT)
})

test('a Callout mounts its title and body as text, not bare strings in a View', () => {
  const { tree } = draw(d('Callout', { variant: 'success', title: 'Done' }, ['All checks passed.']))
  expect(findByText(tree, 'Done')?.type).toBe(NATIVE_TEXT)
  expect(findByText(tree, 'All checks passed.')?.type).toBe(NATIVE_TEXT)
})

test('a StatCard mounts its label, value and delta', () => {
  const { tree } = draw(d('StatCard', { label: 'Revenue', value: '£1,204', delta: '+12%' }))
  for (const word of ['Revenue', '£1,204', '+12%']) {
    expect(findByText(tree, word)?.type).toBe(NATIVE_TEXT)
  }
})

test('a Markdown descriptor goes through the token renderer, not a DOM injection', () => {
  const { tree } = draw(d('Markdown', { text: '# Hi\n\nwith **bold**' }))
  expect(findByText(tree, 'Hi')).toBeTruthy()
  expect(findByText(tree, 'bold')).toBeTruthy()
})

test('a component nobody ships never reaches the reader as its own JSON', () => {
  // The bug this whole change is about: the fallback used to print
  // `type: {…props}`. On a phone that is a wall of braces where a card should be.
  const { tree } = draw(d('MyWidget', { secret: 'value' }, [d('Paragraph', {}, ['the actual answer'])]))
  const text = findAll(tree, () => true)
    .map((n) => (Array.isArray(n.children) ? n.children.filter((c) => typeof c === 'string').join('') : ''))
    .join('')
  expect(text.includes('MyWidget')).toBe(false)
  expect(text.includes('secret')).toBe(false)
  // The content inside it survives.
  expect(findByText(tree, 'the actual answer')).toBeTruthy()
})

/**
 * `quote`/`callout`/`table`/`keyvalue` all wrap their text in a `Prim.Box`/`Prim.Row` (an RN
 * `View`), which drops `color`/`fontSize`/`fontWeight` rather than passing it to the `Prim.Text`
 * inside — so before this these rendered in body ink/size regardless of the descriptor's own tone
 * or the renderer's compact scale. Asserted on the LEAF text node, in both themes (light mode makes
 * this invisible whenever the fallback happens to read close enough to the intended tone).
 */
test('a quote renders its text in the muted/italic quote tone, in both themes', () => {
  for (const [theme, ink] of [['light', '#5c636b'], ['dark', '#98a0a9']] as const) {
    const { tree } = render(<>{renderDescriptor(d('quote', {}, ['a quoted line']))}</>, { theme })
    const node = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.includes('a quoted line'))
    expect(node).toBeDefined()
    expect(node?.style.color).toBe(ink)
    expect(node?.style.fontStyle).toBe('italic')
  }
})

test('a success callout renders its title in the success tone, in both themes', () => {
  for (const [theme, ink] of [['light', '#2c6b48'], ['dark', '#63a684']] as const) {
    const { tree } = render(<>{renderDescriptor(d('callout', { variant: 'success', title: 'Done' }, ['All checks passed.']))}</>, { theme })
    const title = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.includes('Done'))
    const body = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.includes('All checks passed.'))
    expect(title).toBeDefined()
    expect(title?.style.color).toBe(ink)
    expect(body).toBeDefined()
    expect(body?.style.color).toBe(ink)
  }
})

test('a table header cell renders bold muted text, in both themes', () => {
  // A registered weight resolves onto a distinct FONT FAMILY name (`<face>-SemiBold`/`-Medium`),
  // not a numeric `fontWeight` style — Android cannot synthesise a weight from one registered face
  // (`theme/tamagui.config.ts`), so that is what a "bold" assertion has to check here.
  for (const [theme, ink] of [['light', '#5c636b'], ['dark', '#98a0a9']] as const) {
    const { tree } = render(<>{renderDescriptor(d('table', { columns: ['Name'], rows: [] }))}</>, { theme })
    const header = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.includes('Name'))
    expect(header).toBeDefined()
    expect(header?.style.color).toBe(ink)
    expect(String(header?.style.fontFamily).endsWith('-SemiBold')).toBe(true)
  }
})

test('a keyvalue pair renders at the compact 12px scale, in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    const { tree } = render(<>{renderDescriptor(d('keyvalue', { pairs: { Status: 'active' } }))}</>, { theme })
    const key = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.includes('Status'))
    expect(key).toBeDefined()
    expect(key?.style.fontSize).toBe(12)
  }
})

test('a LIST of blocks — what a team channel post is — mounts every one', () => {
  // The team channels store THING's whole turn as `blocks`, so the renderer is
  // handed an array. A bare string in that array is the "Text strings must be
  // rendered within a <Text>" trap all over again, one level up.
  const { tree } = draw([
    d('Heading', {}, ['Report']),
    'a loose line the unwrap left behind',
    d('Paragraph', {}, ['and a real one']),
  ])
  expect(findByText(tree, 'Report')?.type).toBe(NATIVE_TEXT)
  expect(findByText(tree, 'a loose line the unwrap left behind')?.type).toBe(NATIVE_TEXT)
  expect(findByText(tree, 'and a real one')?.type).toBe(NATIVE_TEXT)
})

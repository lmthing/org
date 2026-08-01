/**
 * Container-styles-text-but-the-nested-Text-doesn't-restate-it, RENDERED on the React Native
 * target.
 *
 * `Prim.Box`/`Prim.Pressable`/`Prim.Row`/`Prim.Col` are RN `View`s: `color`/`fontFamily`/`fontSize`/
 * `fontWeight` set on one of them style the CONTAINER and go nowhere else — there is no cascade
 * into a nested `Prim.Text`, which gets `NativeText`'s own unconditional `fontFamily: '$body'` /
 * `color: '$foreground'` defaults instead (`primitives/_native.tsx#NativeText`). A jsdom test
 * cannot see this: `isWeb` is always true there, and the web `<span>` really does inherit from its
 * parent `<div>`, so the exact same markup that is broken on a device looks correct in every
 * existing component test. Asserted on the LEAF text node in both themes — light mode hides most of
 * these, because the muted/default tokens the bug falls back to often read close to the intended
 * colour there.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, findPressable, flattenStyle, NATIVE_TEXT } from '../render'
import { Message } from '../../src/chat/app/Message'
import { useStore } from '../../src/chat/store/store'
import type { ConvoBlock, ExecNode } from '../../src/chat/store/model'
import { ListItem } from '../../src/elements/content/list-item'
import { ActivityStrip } from '../../src/chat/app/ActivityStrip'
import * as Prim from '../../src/elements/primitives/index'

/** A minimal session node — `kind: 'session'` so `Message` skips the attribution button entirely. */
const node: ExecNode = {
  id: 'n1', parentId: null, kind: 'session', label: 'THING', status: 'done',
  childIds: [], depTaskIds: [], llmCalls: [], statements: [], yields: [], variables: {},
  eventSeqs: [],
}

/** `#2f6270` and `rgba(47, 98, 112, 1)` are the same paint — reduce both to `47,98,112`. */
function rgb(colour: unknown): string {
  const s = String(colour ?? '')
  const hex = /^#([0-9a-f]{6})$/i.exec(s)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).join(',')
  const fn = /^rgba?\(([^)]+)\)$/.exec(s)
  if (fn) return fn[1]!.split(',').slice(0, 3).map((p) => p.trim()).join(',')
  return s
}

function resetStore(): void {
  useStore.setState({ model: { nodes: { n1: node }, rootId: 'n1', blocks: [], rawEvents: [], lastSeq: 0 } })
}

test('a cancelled ask block paints "cancelled" muted and mono, in both themes', () => {
  // Message.tsx: the `Prim.Box` around this literal wraps `fontSize`/`color`/`fontFamily` around a
  // bare `<Prim.Text>cancelled</Prim.Text>` that used to restate none of them.
  const block: ConvoBlock = { id: 'b1', ts: 0, nodeId: 'n1', type: 'ask', askId: 'a1', descriptor: undefined, state: 'cancelled' }
  for (const [theme, ink] of [['light', '#5c636b'], ['dark', '#98a0a9']] as const) {
    resetStore()
    const { tree } = render(<Message block={block} />, { theme })
    const cancelled = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.includes('cancelled'))
    expect(cancelled).toBeDefined()
    expect(cancelled?.style.color).toBe(ink)
    expect(cancelled?.style.fontFamily).toBe('JetBrains Mono')
  }
})

test('an answered ask block paints its checkmark+preview in knowledge mono, in both themes', () => {
  // Message.tsx: the same drop as `cancelled` below, on the OTHER branch of the same conditional —
  // `Prim.Box` wraps a bare `✓ {preview(...)}` that used to restate none of `fontSize`/`color`/
  // `fontFamily` either.
  const block: ConvoBlock = { id: 'b3', ts: 0, nodeId: 'n1', type: 'ask', askId: 'a1', descriptor: undefined, state: 'answered', answer: 'yes' }
  for (const [theme, ink] of [['light', '#4a6b52'], ['dark', '#7fa78c']] as const) {
    resetStore()
    const { tree } = render(<Message block={block} />, { theme })
    const answered = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.some((c) => typeof c === 'string' && c.includes('yes')))
    expect(answered).toBeDefined()
    expect(answered?.style.color).toBe(ink)
    expect(answered?.style.fontFamily).toBe('JetBrains Mono')
  }
})

test('an error block paints its message in destructive mono, in both themes', () => {
  const block: ConvoBlock = { id: 'b2', ts: 0, nodeId: 'n1', type: 'error', message: 'the sandbox crashed' }
  for (const [theme, ink] of [['light', '#a8322a'], ['dark', '#d4685c']] as const) {
    resetStore()
    const { tree } = render(<Message block={block} />, { theme })
    const msg = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.includes('the sandbox crashed'))
    expect(msg).toBeDefined()
    expect(msg?.style.color).toBe(ink)
    expect(msg?.style.fontFamily).toBe('JetBrains Mono')
  }
})

test('a selected ListItem label is BOLDER than an unselected one, in both themes', () => {
  // `ListItem`'s row (a `Prim.Box`) conditionally sets `fontWeight: '$medium'` when `selected`, but
  // that lands on the row (an RN View) and not the label — the label used to hardcode
  // `color="$foreground"` regardless of `selected`, so the row's own weight/colour bump never
  // reached its own text. `$accent-foreground` happens to equal `$foreground` in this palette, so
  // colour cannot tell fixed from broken here — but WEIGHT can. Android cannot synthesise a weight
  // from a single registered face, so Tamagui resolves `fontWeight: '$medium'` onto a distinct
  // registered FAMILY NAME (`<face>-Medium`, `theme/tamagui.config.ts`) rather than a numeric
  // `fontWeight` style value — that is what this asserts on.
  for (const theme of ['light', 'dark'] as const) {
    const unselected = render(<ListItem label="Alpha" />, { theme })
    const selected = render(<ListItem selected label="Alpha" />, { theme })
    const unselectedStyle = flattenStyle(findAll(unselected.tree, (t) => t === NATIVE_TEXT)[0]?.props?.style)
    const selectedStyle = flattenStyle(findAll(selected.tree, (t) => t === NATIVE_TEXT)[0]?.props?.style)
    expect(String(selectedStyle.fontFamily).endsWith('-Medium')).toBe(true)
    expect(String(unselectedStyle.fontFamily).endsWith('-Medium')).toBe(false)
  }
})

test('an ActivityStrip chip label takes the STATUS colour and size, not body ink, in both themes', () => {
  // The generalisation of every case above, and the one `lint-rn-text-inherit.mjs` was written for:
  // the chip's `Prim.Pressable` carries `fontSize="$xs"` and the STATUS colour (`node-meta.ts`'s
  // `STATUS_COLOR.running` → `$brand-2`), and four `Prim.Text` leaves used to restate neither. On a
  // phone a `running` chip therefore read as body ink at body size — legible, so nothing catches it,
  // while the entire job of a status chip is that its colour IS the status.
  //
  // Asserted RELATIVE to the container rather than against a hex, because that is the actual
  // invariant ("the leaf resolves what the chip resolves") and it holds in both themes without this
  // suite having to know the palette. `$foreground` is named as the exact wrong answer so a
  // regression is legible when it fires.
  const running: ExecNode = { ...node, id: 'n2', kind: 'llm', label: 'thinking', status: 'running' }
  for (const theme of ['light', 'dark'] as const) {
    useStore.setState({ model: { nodes: { n2: running }, rootId: 'n2', blocks: [], rawEvents: [], lastSeq: 0 } })
    const { tree } = render(<ActivityStrip nodeIds={['n2']} />, { theme })
    const chip = flattenStyle(findPressable(tree)?.props?.style)
    const label = findAll(tree, (t) => t === NATIVE_TEXT)
      .map((n) => ({ style: flattenStyle(n.props?.style), children: n.children }))
      .find((n) => n.children?.includes('thinking'))
    expect(label).toBeDefined()
    // Compared as RGB triples, not as strings. The two hosts reach the same colour by different
    // routes — a `View`'s props go through `_native.tsx#toNativeColor`, which emits `rgba(47, 98,
    // 112, 1)`, while `NativeText` resolves `$brand-2` through Tamagui's theme and emits `#2f6270`.
    // Identical paint, different notation; asserting on the literal string would fail on a match.
    expect(rgb(label?.style.color)).toBe(rgb(chip.color))

    // The chip's OWN `fontSize` is not merely unused on native — it is absent from the View's style
    // entirely (`nativeSafeProps` drops what `RCTView` has no use for), which is why there is
    // nothing here to compare the label against. Both reference values are therefore rendered rather
    // than hardcoded, so this case survives a change to the type scale or the palette.
    expect(chip.fontSize).toBe(undefined)
    const refStyle = (el: React.ReactElement) =>
      flattenStyle(findAll(render(el, { theme }).tree, (t) => t === NATIVE_TEXT)[0]?.props?.style)
    expect(label?.style.fontSize).toBe(refStyle(<Prim.Text fontSize="$xs">x</Prim.Text>).fontSize)
    // The bug's signature: `NativeText`'s unconditional `$foreground` default winning over the
    // container.
    expect(label?.style.color === refStyle(<Prim.Text>x</Prim.Text>).color).toBe(false)
  }
})

/**
 * Regression guards for `lint-rn-text-children.mjs`'s findings — a bare string/expression that
 * used to sit directly under a View primitive (`Prim.Box`/`Row`/`Pressable`) and DROP on native
 * (`string-children.tsx` proves the same property for the four leaves `labelled()` already
 * covered; this is the sibling for the call-site fixes the gate found across the surfaces).
 *
 * Two things are asserted per case, same as `text-styling.tsx`:
 *   1. the string mounts inside an `RCTText`, not loose in a View — the crash-vs-not property;
 *   2. its resolved colour matches the CONTAINER's restated prop, in BOTH themes — because a bare
 *      restatement of the wrong value would swap "dropped" for "wrong colour", which is just as
 *      real a regression and light mode hides most colour bugs (the muted/default tokens many of
 *      these fall back to read close to correct there).
 *
 * Hex values below are read straight off `libs/css/src/tamagui/tokens.generated.ts` (light/dark),
 * the same source `text-styling.tsx` uses, so a token rename shows up as a failure here too.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import { render, findAll, flattenStyle, NATIVE_TEXT, type NativeNode } from '../render'
import { ConsentCard } from '../../src/chat/components/ConsentCard'
import { VariablesBlock } from '../../src/chat/components/VariablesBlock'
import { TabBar } from '../../src/elements/nav/tab-bar'
import { Tabs as InspectorTabs } from '../../src/chat/app/common'
import { Tabs as ChannelTabs } from '../../src/chat/components/ui/Tabs'
import { ExecutionTree } from '../../src/chat/app/tree'
import { useStore } from '../../src/chat/store/store'
import type { ExecNode } from '../../src/chat/store/model'

/** Every string in the tree that is NOT sitting inside an `RCTText` — RN's own check, restated. */
function looseStrings(tree: unknown): string[] {
  const out: string[] = []
  for (const node of findAll(tree as never, (t) => t !== NATIVE_TEXT) as NativeNode[]) {
    for (const child of node.children ?? []) {
      if (typeof child === 'string' && child.trim() !== '') out.push(child)
    }
  }
  return out
}

/** The flattened style of the first `RCTText` whose children include `text`. */
function styleOfText(tree: unknown, text: string): Record<string, unknown> | undefined {
  return findAll(tree as never, (t) => t === NATIVE_TEXT)
    .map((n) => ({ style: flattenStyle((n as NativeNode).props?.style), children: (n as NativeNode).children }))
    .find((n) => n.children?.some((c) => typeof c === 'string' && c.includes(text)))?.style
}

for (const [theme, foreground, muted] of [
  ['light', '#14171a', '#5c636b'],
  ['dark', '#e7eaed', '#98a0a9'],
] as const) {
  test(`ConsentCard's "THING wants to run" and "space:" mount as text, ink matches, in ${theme}`, () => {
    const { tree } = render(
      <ConsentCard fn="installSpace" space="my-space" onApprove={() => {}} onDeny={() => {}} />,
      { theme },
    )
    expect(looseStrings(tree).join('|'), 'ConsentCard leaves no string loose in a View').toBe('')
    // `THING wants to run` restates the Box's `color="$foreground"`.
    expect(styleOfText(tree, 'THING wants to run')?.color).toBe(foreground)
    // `space: ` restates the Box's `color="$muted-foreground"`.
    expect(styleOfText(tree, 'space:')?.color).toBe(muted)
  })

  test(`VariablesBlock's ': ' separator mounts as text (both themes exercise the same markup: ${theme})`, () => {
    const { tree } = render(<VariablesBlock vars={{ x: 1 }} />, { theme })
    expect(looseStrings(tree).join('|'), 'VariablesBlock leaves no string loose in a View').toBe('')
  })

  test(`ExecutionTree's expand chevron mounts as text, ink matches $muted-foreground, in ${theme}`, () => {
    const child: ExecNode = {
      id: 'c1', parentId: 'r1', kind: 'task', label: 'child', status: 'done',
      childIds: [], depTaskIds: [], llmCalls: [], statements: [], yields: [], variables: {}, eventSeqs: [],
    }
    const root: ExecNode = {
      id: 'r1', parentId: null, kind: 'run', label: 'root', status: 'done',
      childIds: ['c1'], depTaskIds: [], llmCalls: [], statements: [], yields: [], variables: {}, eventSeqs: [],
    }
    useStore.setState({ model: { nodes: { r1: root, c1: child }, rootId: 'r1', blocks: [], rawEvents: [], lastSeq: 0 } })
    const { tree } = render(<ExecutionTree />, { theme })
    expect(looseStrings(tree).join('|'), 'ExecutionTree leaves no string loose in a View').toBe('')
    // Collapsed by default (`expanded` starts as an empty Set), so the glyph is '▸'.
    expect(styleOfText(tree, '▸')?.color).toBe(muted)
  })

  test(`common.tsx's inspector Tabs colour the active tab $foreground and idle ones $muted-foreground, in ${theme}`, () => {
    const { tree } = render(<InspectorTabs tabs={['llm', 'raw'] as const} active="llm" onChange={() => {}} />, { theme })
    expect(looseStrings(tree).join('|'), 'Tabs leaves no string loose in a View').toBe('')
    expect(styleOfText(tree, 'llm')?.color).toBe(foreground)
    expect(styleOfText(tree, 'raw')?.color).toBe(muted)
  })

  test(`chat/components/ui/Tabs colours the active tab $foreground and idle ones $muted-foreground, in ${theme}`, () => {
    const { tree } = render(
      <ChannelTabs tabs={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]} active="a" onChange={() => {}} />,
      { theme },
    )
    expect(looseStrings(tree).join('|'), 'Tabs leaves no string loose in a View').toBe('')
    expect(styleOfText(tree, 'Alpha')?.color).toBe(foreground)
    expect(styleOfText(tree, 'Beta')?.color).toBe(muted)
  })

  test(`TabBar's tab.label mounts as text via labelled(), ink matches active/idle, in ${theme}`, () => {
    const { tree } = render(
      <TabBar
        tabs={[{ id: 'a', label: 'Fields' }, { id: 'b', label: 'Domains' }]}
        activeTab="a"
        onTabChange={() => {}}
      />,
      { theme },
    )
    expect(looseStrings(tree).join('|'), 'TabBar leaves no string loose in a View').toBe('')
    expect(styleOfText(tree, 'Fields')?.color).toBe(foreground)
    expect(styleOfText(tree, 'Domains')?.color).toBe(muted)
  })
}

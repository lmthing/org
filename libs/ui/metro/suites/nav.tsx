/**
 * The nav shell — `AppSidebar`, `SidebarFooter`, `AppLinks` — RENDERED on the React Native target.
 *
 * These are the components a signed-in mobile user sees FIRST, and until this suite existed nothing
 * rendered them on native: the graph gate proves their modules resolve, and jsdom proves they work
 * on web, but neither can see a label that mounts as a bare string inside a native View. The device
 * can — React Native raises "Text strings must be rendered within a <Text> component" and then
 * DROPS the string, so the section headers rendered as naked chevrons with no label at all.
 *
 * Every case below is therefore the same shape: mount the real component through the real
 * reconciler and assert its text is inside an `RCTText`, never loose in an `RCTView`.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import {
  render,
  findAll,
  findByText,
  findByType,
  flattenStyle,
  NATIVE_TEXT,
  NATIVE_VIEW,
} from '../render'
import { AppSidebar } from '../../src/elements/nav/app-sidebar'
import { AppLinks } from '../../src/elements/nav/app-links'
import { Col, Text } from '../../src/elements/primitives'
import { Drawer } from '../../src/chat/components/ui/Drawer'

/**
 * The invariant the device enforces and no other harness does: a string child may only sit under a
 * text host. Walking the mounted tree for a `RCTView` with a direct string child reproduces
 * React Native's own check, so a regression fails here instead of on a phone.
 */
function looseStrings(tree: unknown): string[] {
  const out: string[] = []
  for (const node of findAll(tree as never, (type) => type !== NATIVE_TEXT)) {
    for (const child of node.children ?? []) {
      if (typeof child === 'string' && child.trim() !== '') out.push(child)
    }
  }
  return out
}

const SIDEBAR_PROPS = {
  projects: [{ id: 'p1', name: 'Demo project' }],
  activeProjectId: 'p1',
  onSelectProject: () => {},
  onCreateProject: async () => {},
  onDeleteProject: async () => {},
  spaces: [{ id: 's1', name: 'A space' }],
  activeSpaceId: null,
  onSelectSpace: () => {},
  spacesLoading: false,
}

test('the sidebar renders no bare strings outside a native text host', () => {
  const { tree } = render(<AppSidebar {...SIDEBAR_PROPS} />)
  expect(looseStrings(tree)).toEqual([])
})

test('a collapsed section header still renders its label as text', () => {
  const { tree } = render(<AppSidebar {...SIDEBAR_PROPS} />)
  // `Spaces` is the header the device rendered as a naked chevron.
  const label = findByText(tree, 'Spaces')
  expect(label?.type).toBe(NATIVE_TEXT)
})

test('the project dropdown trigger renders its project name as text', () => {
  const { tree } = render(<AppSidebar {...SIDEBAR_PROPS} />)
  const label = findByText(tree, 'Demo project')
  expect(label?.type).toBe(NATIVE_TEXT)
})

test('the cross-app link row renders no bare strings outside a native text host', () => {
  const { tree } = render(<AppLinks current="chat" bordered />)
  expect(looseStrings(tree)).toEqual([])
})

/**
 * `display: 'flex'` is a ROW on web and a COLUMN on React Native (see `nativeSafeProps`). The
 * sidebar's section header and dropdown trigger both rely on the web default, and when native
 * disagreed their labels did not merely stack — the web truncation idiom on the label
 * (`flexGrow: 1, flexBasis: '0%'`) started sizing HEIGHT instead of width and the text vanished.
 * These two assert the direction on the real components, so the seam cannot regress silently.
 */
test('a section header lays its chevron and label out as a ROW, as on web', () => {
  const { tree } = render(<AppSidebar {...SIDEBAR_PROPS} />)
  const label = findByText(tree, 'Spaces')
  expect(label).toBeTruthy()
  const header = findAll(tree, () => true).find((n) =>
    (n.children ?? []).some((c) => c !== null && typeof c === 'object' && c === label),
  )
  expect(flattenStyle(header?.props?.style).flexDirection).toBe('row')
})

/**
 * React Native has no `position: 'fixed'`, so an overlay written the web way stops overlaying and
 * joins normal flow — which is how the chat `Drawer` came to sit BESIDE the transcript on a phone
 * and push it off the screen instead of covering it.
 */
test('a fixed-position overlay becomes absolute, so it still overlays', () => {
  const { tree } = render(
    <Drawer open onClose={() => {}} side="left" width="16rem">
      <Text>drawer body</Text>
    </Drawer>,
  )
  const root = findByType(tree, NATIVE_VIEW)
  expect(flattenStyle(root?.props?.style).position).toBe('absolute')
})

test('a Col that also writes display:flex stays a column', () => {
  const { tree } = render(
    <Col display="flex">
      <Text>a</Text>
    </Col>,
  )
  expect(flattenStyle(findByType(tree, NATIVE_VIEW)?.props?.style).flexDirection).toBe('column')
})

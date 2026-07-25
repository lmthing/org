/**
 * The overlay forks on the React Native target.
 *
 * These three forks exist *because* of this harness: the graph gate caught `dialog`, `sheet` and
 * `context-menu` importing `react-dom` with no native fork, despite a comment claiming one. The
 * gate proves the DOM renderer is gone; these cases prove something that works was put in its
 * place.
 *
 * Each case asserts that a WEB MECHANISM was replaced by the platform's own, not merely deleted:
 * the `document.body` portal by `Modal`, `position: fixed` by flex inside it, and right-click by
 * long press.
 */
import * as React from 'react'
import { test, expect } from '../harness'
import {
  render,
  find,
  findAll,
  findByText,
  findByType,
  findByProp,
  findByStyle,
  flattenStyle,
  press,
  longPress,
  NATIVE_VIEW,
} from '../render'
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DIALOG_BACKDROP,
  DIALOG_BASE,
  DIALOG_CONTENT,
  DIALOG_HEADER,
} from '../../src/elements/overlays/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../../src/elements/overlays/sheet'
import * as ContextMenu from '../../src/elements/overlays/context-menu'

type Tree = ReturnType<typeof render>['tree']

/** RN's Modal host view. Its presence IS the evidence that no `react-dom` portal is involved. */
const MODAL = 'RCTModalHostView'
const modalOf = (tree: Tree) => find(tree, (t) => t === MODAL)
/**
 * The OPEN modal, if any. Closing does not unmount `RCTModalHostView` — RN keeps it around with
 * `visible: false` once it has been shown (it owns the dismiss animation), so "is the dialog
 * closed?" is a question about `visible`, not about presence in the tree.
 */
const openModalOf = (tree: Tree) =>
  findAll(tree, (t) => t === MODAL).find((n) => n.props.visible === true) ?? null
/** The full-screen view each fork mounts directly inside the Modal. */
const viewportOf = (tree: Tree) => findByProp(tree, 'accessibilityViewIsModal', true)
/** The dismissing backdrop — identified by what it is styled as; every layout view is an RCTView. */
const backdropOf = (tree: Tree) => findByStyle(tree, 'backgroundColor', 'rgba(0,0,0,0.5)')

// ── Dialog ────────────────────────────────────────────────────────────────────────────────────

test('a closed Dialog mounts nothing at all', () => {
  const { tree } = render(
    <Dialog>
      <DialogContent>
        <DialogTitle>secret</DialogTitle>
      </DialogContent>
    </Dialog>,
  )
  expect(tree).toBeNull()
})

test('an open Dialog mounts through RN Modal, not a portal', () => {
  const { tree } = render(
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>hello dialog</DialogTitle>
      </DialogContent>
    </Dialog>,
  )
  const modal = modalOf(tree)
  expect(modal).toBeTruthy()
  expect(modal?.props.visible).toBe(true)
  expect(modal?.props.transparent).toBe(true)
  expect(modal?.props.animationType).toBe('fade')
  expect(findByText(tree, 'hello dialog')).toBeTruthy()
})

test('the open Dialog is centred by flex, since RN has no position: fixed', () => {
  const { tree } = render(
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>centred</DialogTitle>
      </DialogContent>
    </Dialog>,
  )
  expect(flattenStyle(viewportOf(tree)?.props.style)).toMatchObject({
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  })
})

test('DialogTrigger opens it and DialogClose closes it again', () => {
  const { tree, current } = render(
    <Dialog>
      <DialogTrigger>open</DialogTrigger>
      <DialogContent>
        <DialogClose>done</DialogClose>
      </DialogContent>
    </Dialog>,
  )
  expect(openModalOf(tree)).toBeNull()

  press(findByType(tree, NATIVE_VIEW))
  expect(openModalOf(current())).toBeTruthy()

  press(findByText(current(), 'done'))
  expect(openModalOf(current())).toBeNull()
})

test('pressing the backdrop dismisses the Dialog', () => {
  const { tree, current } = render(
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>dismiss me</DialogTitle>
      </DialogContent>
    </Dialog>,
  )
  press(backdropOf(tree))
  expect(openModalOf(current())).toBeNull()
})

test('DialogHeader/Title/Description render as native text inside the panel', () => {
  const { tree } = render(
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>the title</DialogTitle>
          <DialogDescription>the description</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  )
  expect(findByText(tree, 'the title')).toBeTruthy()
  expect(findByText(tree, 'the description')).toBeTruthy()
})

test('the exported DIALOG_* bags hold no web-only style values', () => {
  // Surfaces (`studio/space/space-list`, `save-agent-modal`, `new-folder-modal`, …) spread these
  // onto a primitive on BOTH targets, so the native file cannot re-export the web values: RN has no
  // `position: fixed`, no `display: grid`, and takes `transform` as an array, not a CSS string.
  const bags: Record<string, Record<string, unknown>> = {
    DIALOG_BACKDROP,
    DIALOG_BASE,
    DIALOG_CONTENT,
    DIALOG_HEADER,
  }
  for (const [name, bag] of Object.entries(bags)) {
    expect(`${name}.position=${String(bag.position ?? 'absolute')}`).toBe(`${name}.position=absolute`)
    expect(`${name}.display=${String(bag.display ?? 'unset')}`).toBe(`${name}.display=unset`)
    expect(`${name}.transform=${typeof bag.transform}`).toBe(`${name}.transform=undefined`)
  }
  // …and the tokens still come from the shared theme.
  expect(DIALOG_BASE.backgroundColor).toBe('$background')
})

// ── Sheet ─────────────────────────────────────────────────────────────────────────────────────

test('the Sheet slides in and is pinned to the right by default', () => {
  const { tree } = render(
    <Sheet defaultOpen>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>panel</SheetTitle>
        </SheetHeader>
      </SheetContent>
    </Sheet>,
  )
  // The web file dropped its `data-[state]:slide-in` rules as dead; on native the platform animates.
  expect(modalOf(tree)?.props.animationType).toBe('slide')
  // `position: fixed; right: 0` becomes the row's justifyContent.
  expect(flattenStyle(viewportOf(tree)?.props.style)).toMatchObject({
    flexDirection: 'row',
    justifyContent: 'flex-end',
  })
  expect(findByText(tree, 'panel')).toBeTruthy()
})

test('side="left" pins the Sheet to the other end', () => {
  const { tree } = render(
    <Sheet defaultOpen>
      <SheetContent side="left">
        <SheetTitle>left panel</SheetTitle>
      </SheetContent>
    </Sheet>,
  )
  expect(flattenStyle(viewportOf(tree)?.props.style).justifyContent).toBe('flex-start')
})

test('SheetTrigger opens it and the backdrop dismisses it', () => {
  const { tree, current } = render(
    <Sheet>
      <SheetTrigger>open</SheetTrigger>
      <SheetContent>
        <SheetTitle>panel</SheetTitle>
      </SheetContent>
    </Sheet>,
  )
  expect(openModalOf(tree)).toBeNull()
  press(findByType(tree, NATIVE_VIEW))
  expect(openModalOf(current())).toBeTruthy()
  press(backdropOf(current()))
  expect(openModalOf(current())).toBeNull()
})

// ── ContextMenu ───────────────────────────────────────────────────────────────────────────────

test('the ContextMenu opens on LONG PRESS, at the touch point', async () => {
  const { tree, current } = render(
    <ContextMenu.Root>
      <ContextMenu.Trigger>target</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item>rename</ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>,
  )
  expect(openModalOf(tree)).toBeNull()

  // There is no right-click on a touch device. Long press is the platform's "more options" gesture,
  // and its event carries the page coordinates the web version read from `clientX`/`clientY` — so
  // the open-at-the-cursor behaviour survives the swap intact.
  await longPress(findByType(tree, NATIVE_VIEW), { pageX: 120, pageY: 240 })

  expect(openModalOf(current())).toBeTruthy()
  // Selected by role, not by `position: absolute` — the Modal host view is absolutely positioned
  // too, and matched first.
  const panel = findByProp(current(), 'accessibilityRole', 'menu')
  expect(flattenStyle(panel?.props.style)).toMatchObject({ top: 240, left: 120 })
  expect(findByText(current(), 'rename')).toBeTruthy()
})

test('selecting a ContextMenu item fires onClick and closes the menu', async () => {
  let chosen = 0
  const { tree, current } = render(
    <ContextMenu.Root>
      <ContextMenu.Trigger>target</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item onClick={() => chosen++}>rename</ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>,
  )
  await longPress(findByType(tree, NATIVE_VIEW), { pageX: 10, pageY: 20 })
  press(findByText(current(), 'rename'))
  expect(chosen).toBe(1)
  expect(openModalOf(current())).toBeNull()
})

import * as React from 'react'
import { Modal, Pressable as RNPressable, type GestureResponderEvent } from 'react-native'
import { NativeView } from '../../primitives/_native'

/**
 * ContextMenu (native fork). Same Radix-shaped namespace as `index.tsx` — Root/Trigger/Portal/
 * Content/Item/Separator — so `import * as ContextMenu` call sites are cross-target. Metro prefers
 * this `.native.tsx`; web keeps `index.tsx`.
 *
 * Exists because the web file portals through `react-dom`. RN's `Modal` needs no portal.
 *
 * **The gesture is the real difference, and it is not cosmetic.** There is no right-click on a
 * touch device, so `onContextMenu` has no counterpart to bind: the trigger opens on LONG PRESS,
 * which is the platform's established "more options here" gesture. The menu still opens at the
 * touch point — RN's press event carries `pageX`/`pageY`, so the cursor-coordinate behaviour
 * survives exactly.
 *
 * Two smaller divergences:
 *
 * - **`asChild` wraps instead of merging.** On web it clones the child with `onContextMenu` to avoid
 *   an extra DOM node. There is no handler to merge here (a native fork would drop `onContextMenu`
 *   silently), so the child is wrapped in a pressable either way. The prop is still accepted so call
 *   sites do not fork.
 * - **Dismissal** is a backdrop press or Android back (`onRequestClose`), replacing the web file's
 *   deferred `mousedown`/`keydown` document listeners.
 *
 * See docs/react-native-tamagui-migration.md §7 step 7.
 */
type Pt = { x: number; y: number }
type Ctx = { open: boolean; pos: Pt; openAt: (p: Pt) => void; close: () => void }
const MenuContext = React.createContext<Ctx>({ open: false, pos: { x: 0, y: 0 }, openAt: () => {}, close: () => {} })

/** The floating menu panel. `top`/`left` are the touch point, so they stay inline (as on web). */
const MENU_BASE = {
  position: 'absolute',
  backgroundColor: '$popover',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  paddingVertical: '$1',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 4 },
  shadowRadius: 8,
} as const

const MENU_SEPARATOR = { height: 1, backgroundColor: '$border', marginVertical: '$1' } as const

function Root({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState<Pt>({ x: 0, y: 0 })
  const openAt = React.useCallback((p: Pt) => { setPos(p); setOpen(true) }, [])
  const close = React.useCallback(() => setOpen(false), [])
  // No document listeners: on native the Modal's own backdrop and `onRequestClose` do the
  // dismissing, so there is nothing to subscribe to and nothing to defer past the opening event.
  return <MenuContext.Provider value={{ open, pos, openAt, close }}>{children}</MenuContext.Provider>
}

function Trigger({ asChild: _asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  const { openAt } = React.useContext(MenuContext)
  const onLongPress = (event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent
    openAt({ x: pageX, y: pageY })
  }
  return (
    <RNPressable onLongPress={onLongPress} {...props}>
      {children}
    </RNPressable>
  )
}

/** Passthrough — the Content mounts its own Modal (kept for Radix-shaped call sites). */
function Portal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function Content({ children, style, ...props }: Record<string, unknown> & { children?: React.ReactNode; style?: object }) {
  const { open, pos, close } = React.useContext(MenuContext)
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={close}>
      <NativeView flex={1} onPress={close}>
        <NativeView
          accessibilityRole="menu"
          {...MENU_BASE}
          // The touch point, so a Tamagui prop would mint one atomic rule per distinct value —
          // the same reason the web file keeps these inline.
          style={{ top: pos.y, left: pos.x, ...style }}
          {...props}
        >
          {children}
        </NativeView>
      </NativeView>
    </Modal>
  )
}

/**
 * A menu row. `NativeView` rather than `Prim.Pressable`: the Pressable fork forwards only
 * `style`/`children`/`onClick`/`disabled`, so the `menuitem` accessibility role a menu row needs
 * would be dropped on the way through — and its prop type is web-shaped (`ButtonHTMLAttributes`),
 * which has no `accessibilityRole` to pass in the first place.
 *
 * The public prop stays `onClick`, web-shaped, so a call site does not fork; the empty event object
 * mirrors what `primitives/_native#toPressHandler` hands a web handler on this target.
 */
function Item({ onClick, children, ...props }: Record<string, unknown> & { onClick?: (event: unknown) => void; children?: React.ReactNode }) {
  const { close } = React.useContext(MenuContext)
  return (
    <NativeView
      accessibilityRole="menuitem"
      onPress={() => { onClick?.({}); close() }}
      {...props}
    >
      {children}
    </NativeView>
  )
}

function Separator(props: Record<string, unknown>) {
  return <NativeView accessibilityRole="none" {...MENU_SEPARATOR} {...props} />
}

export { Root, Trigger, Portal, Content, Item, Separator }

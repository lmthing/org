import * as React from 'react'
import { Modal, type GestureResponderEvent } from 'react-native'
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
 *   an extra DOM node. There is no handler to merge here — `onContextMenu` is a DOM event and
 *   `nativeSafeProps` drops it — so the child is wrapped either way. The prop is still accepted so
 *   call sites do not fork.
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
    <NativeView onLongPress={onLongPress} {...props}>
      {children}
    </NativeView>
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
          // The touch point, as PROPS. The web file keeps these inline because a Tamagui prop mints
          // one atomic CSS rule per distinct value — an unbounded stylesheet for a menu that can open
          // anywhere. There is no stylesheet on native: props resolve straight to a style object, so
          // the reason does not carry over and the idiomatic form wins.
          top={pos.y}
          left={pos.x}
          style={style}
          {...props}
        >
          {children}
        </NativeView>
      </NativeView>
    </Modal>
  )
}

/**
 * A menu row. The public prop stays `onClick`, web-shaped, so a call site does not fork; the empty
 * event object mirrors what `primitives/_native#toPressHandler` hands a web handler on this target.
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

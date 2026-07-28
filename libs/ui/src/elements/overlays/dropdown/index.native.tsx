import * as React from 'react'
import { Modal } from 'react-native'
import { getWindowSize } from '../../../platform/dimensions'
import { labelled } from '../../primitives/labelled'
import { NativeView } from '../../primitives/_native'
import { DROPDOWN_CONTENT_SHARED, DROPDOWN_ITEM_SHARED } from './styles'

/**
 * Dropdown (native fork). Same compound API as `index.tsx` — Dropdown/Trigger/Content/Item/Separator
 * plus the exported `DROPDOWN_*` prop bags — so a surface component is cross-target. Metro prefers
 * this `.native.tsx`; web keeps `index.tsx`.
 *
 * **Why this one is not shaped like the other three overlay forks.** Dialog, Sheet and ContextMenu
 * are screen-level: their content belongs nowhere in particular, so `Modal` alone is the whole
 * answer. A dropdown is ANCHORED to its trigger, and the web file gets that for free from a
 * `position: relative` wrapper holding a `position: absolute` panel.
 *
 * That structure would port directly to RN — but it cannot also close on an outside press. RN has no
 * `position: fixed`, so an absolutely-positioned view only ever covers its own parent, and the web
 * file's `document.addEventListener('mousedown', …)` has nothing to bind to. Screen-level dismissal
 * needs a `Modal`, and a `Modal` breaks the anchoring, so the anchor has to be measured back:
 * `measureInWindow` on the trigger when it opens, and the panel is placed under the result.
 *
 * The trade-off is stated because it is real: **until the first measurement lands the panel sits at
 * the top-left**, which is one frame on a device and permanent in a test with no layout pass. The
 * alternative — no Modal — would leave a menu that cannot be dismissed by tapping away from it, and
 * that is the worse failure.
 *
 * ESC → `onRequestClose` (Android back), as in the Dialog fork.
 *
 * See docs/react-native-tamagui-migration.md §7 step 7.
 */

/**
 * `.dropdown__content` — the popover panel, native-valid. Same NAME as the web bag because a surface
 * may spread it on either target; `color` is dropped because it styles TEXT and this is a View (RN
 * does not inherit it the way CSS does — a text child carries its own color).
 */
export const DROPDOWN_CONTENT = { ...DROPDOWN_CONTENT_SHARED } as const

/**
 * `.dropdown__item`. `hoverStyle` becomes `pressStyle` — there is no hover on a touch device, and
 * press IS the corresponding feedback. `cursor`/`userSelect`/`outline*`/`display` are web-only and
 * dropped; `fontSize`/`color` belong on the text child, not on this View.
 */
export const DROPDOWN_ITEM = {
  ...DROPDOWN_ITEM_SHARED,
  // A touch device has no hover; press is the analogue.
  pressStyle: { backgroundColor: '$accent' },
  disabledStyle: { opacity: 0.5 },
} as const

/** The trigger row. */
const DROPDOWN_TRIGGER = { flexDirection: 'row', alignItems: 'center', gap: '$1' } as const

type Anchor = { x: number; y: number; width: number; height: number }
/**
 * The node the anchor is measured from, described by the ONE method this file calls rather than by
 * an RN class type: a ref through a Tamagui component lands on a host instance (Tamagui renders
 * `createElement('RCTView', …)` directly), which RN's `View` class type does not describe.
 */
type TriggerHandle = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void
}
type Ctx = {
  open: boolean
  setOpen: (o: boolean) => void
  anchor: Anchor | null
  triggerRef: React.MutableRefObject<TriggerHandle | null>
  measure: () => void
}
const DropdownContext = React.createContext<Ctx>({
  open: false,
  setOpen: () => {},
  anchor: null,
  triggerRef: { current: null },
  measure: () => {},
})

export interface DropdownProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Dropdown({ open: openProp, defaultOpen = false, onOpenChange, children }: DropdownProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen)
  const [anchor, setAnchor] = React.useState<Anchor | null>(null)
  const triggerRef = React.useRef<TriggerHandle | null>(null)
  const open = openProp ?? uncontrolled
  const setOpen = React.useCallback(
    (o: boolean) => { if (openProp === undefined) setUncontrolled(o); onOpenChange?.(o) },
    [openProp, onOpenChange],
  )
  /**
   * Read the trigger's position in window coordinates. Deliberately called on open rather than on
   * layout: a dropdown's anchor only matters at the moment it opens, and `measureInWindow` costs a
   * round trip to the native side.
   */
  const measure = React.useCallback(() => {
    triggerRef.current?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
      setAnchor({ x, y, width, height })
    })
  }, [])
  // The web file's `mousedown`/`keydown` listeners live here; on native the Modal's backdrop and
  // `onRequestClose` replace them, so there is nothing to subscribe to.
  return (
    <DropdownContext.Provider value={{ open, setOpen, anchor, triggerRef, measure }}>
      <NativeView>{children}</NativeView>
    </DropdownContext.Provider>
  )
}

function DropdownTrigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  const { open, setOpen, triggerRef, measure } = React.useContext(DropdownContext)
  const toggle = () => {
    if (!open) measure()
    setOpen(!open)
  }
  if (asChild && React.isValidElement(children)) {
    // The clone gets the handler, and a wrapper carries the measuring ref.
    //
    // The ref cannot go on the clone: `asChild` accepts whatever element the caller passes, and
    // most of them — `Button` among them — are plain function components that forward no ref, so
    // it would silently land nowhere. That is what used to happen: `measureInWindow` never fired,
    // the anchor stayed `null`, and `DropdownContent` fell back to `top: 0, left: 0` — a menu
    // across the top of the screen, over the status bar, nowhere near the control that opened it.
    // Measuring a wrapper measures the same box without asking anything of the child.
    return (
      <NativeView ref={triggerRef} collapsable={false}>
        {React.cloneElement(children as React.ReactElement<any>, { onClick: toggle })}
      </NativeView>
    )
  }
  return (
    // `collapsable={false}` keeps Android from optimising the trigger away as a pure layout view —
    // a collapsed view has no native node, and `measureInWindow` on it never calls back. The ref
    // lands on the host node Tamagui renders (`createElement('RCTView', …)`), which is what carries
    // the measurement methods.
    <NativeView
      ref={triggerRef}
      collapsable={false}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      {...DROPDOWN_TRIGGER}
      onPress={toggle}
      {...props}
    >
      {/* A menu item's children are almost always a bare label, and this View would DROP it. */}
      {labelled(children)}
    </NativeView>
  )
}

function DropdownContent({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) {
  const { open, setOpen, anchor } = React.useContext(DropdownContext)
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      {/* Full-screen and invisible: the only way to catch a press outside the panel on native. */}
      <NativeView flex={1} onPress={() => setOpen(false)}>
        <NativeView
          accessibilityRole="menu"
          {...DROPDOWN_CONTENT}
          // The measured anchor, as props — see the context menu fork for why these are not inline
          // styles on this target.
          top={anchor ? anchor.y + anchor.height : 0}
          // Left-aligned with the trigger, EXCEPT when the trigger sits in the right half of the
          // screen, where a left-aligned panel runs off the edge and its labels are cut in half.
          // A phone has no room to spare, and the section menus that use this are all pinned to the
          // right of their header. Anchoring the panel's right edge to the trigger's is what a menu
          // near an edge does everywhere else.
          {...(anchor && anchor.x + anchor.width > getWindowSize().width / 2
            ? { right: Math.max(0, getWindowSize().width - (anchor.x + anchor.width)) }
            : { left: anchor ? anchor.x : 0 })}
          {...props}
        >
          {children}
        </NativeView>
      </NativeView>
    </Modal>
  )
}

function DropdownItem({ onClick, children, ...props }: Record<string, unknown> & { onClick?: (event: unknown) => void; children?: React.ReactNode }) {
  const { setOpen } = React.useContext(DropdownContext)
  return (
    <NativeView
      accessibilityRole="menuitem"
      {...DROPDOWN_ITEM}
      onPress={() => { onClick?.({}); setOpen(false) }}
      {...props}
    >
      {/* A menu item's children are almost always a bare label, and this View would DROP it. */}
      {labelled(children)}
    </NativeView>
  )
}

/** `marginVertical` is a token here, not the web file's `"0.25rem"` — RN has no `rem`. */
function DropdownSeparator(props: Record<string, unknown>) {
  return (
    <NativeView
      accessibilityRole="none"
      height={1}
      width="100%"
      backgroundColor="$border"
      marginVertical="$1"
      {...props}
    />
  )
}

export { Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownSeparator }

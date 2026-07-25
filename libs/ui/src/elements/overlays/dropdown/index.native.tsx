import * as React from 'react'
import { Modal, View as RNView } from 'react-native'
import { NativeView } from '../../primitives/_native'

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
export const DROPDOWN_CONTENT = {
  position: 'absolute',
  zIndex: 50,
  minWidth: '$32',
  overflow: 'hidden',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$popover',
  padding: '$1',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 4 },
  shadowRadius: 6,
} as const

/**
 * `.dropdown__item`. `hoverStyle` becomes `pressStyle` — there is no hover on a touch device, and
 * press IS the corresponding feedback. `cursor`/`userSelect`/`outline*`/`display` are web-only and
 * dropped; `fontSize`/`color` belong on the text child, not on this View.
 */
export const DROPDOWN_ITEM = {
  alignItems: 'center',
  gap: '$2',
  borderRadius: '$radius-sm',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
  pressStyle: { backgroundColor: '$accent' },
  disabledStyle: { opacity: 0.5 },
} as const

/** The trigger row. */
const DROPDOWN_TRIGGER = { flexDirection: 'row', alignItems: 'center', gap: '$1' } as const

type Anchor = { x: number; y: number; width: number; height: number }
/** Whatever an `RNView` ref yields — the node the anchor is measured from. */
type TriggerHandle = React.ComponentRef<typeof RNView>
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
    return React.cloneElement(children as React.ReactElement<any>, { onClick: toggle })
  }
  return (
    // The ref is on a PLAIN RN View, not on the Tamagui one, because **no Tamagui component exposes
    // a host node on native** — `View`, `styled(View)`, `NativeView` and `Prim.Box` all leave the
    // ref null, so `measureInWindow` would never be reachable through one
    // (`.issues/tamagui-primitives-expose-no-native-node-handle.md`). `collapsable={false}` keeps
    // Android from optimising this wrapper away, which would make it unmeasurable.
    <RNView ref={triggerRef} collapsable={false}>
      <NativeView
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        {...DROPDOWN_TRIGGER}
        onPress={toggle}
        {...props}
      >
        {children}
      </NativeView>
    </RNView>
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
          // The measured anchor, so it stays an inline style rather than minting one atomic rule
          // per position (same reasoning as the context menu's touch point).
          style={{ top: anchor ? anchor.y + anchor.height : 0, left: anchor ? anchor.x : 0 }}
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
      {children}
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

import * as React from 'react'
import { Modal } from 'react-native'
import { NativeView } from '../../primitives/_native'
import * as Prim from '../../primitives/index'

/**
 * Sheet (native fork). Same compound API as `index.tsx` — Sheet/Trigger/Close/Content/Header/Title —
 * so a surface component is cross-target. Metro prefers this `.native.tsx`; web keeps `index.tsx`.
 *
 * Exists for the same reason as the Dialog fork: the web file portals through `react-dom` into
 * `document.body`, which pulled the DOM renderer into every native bundle. RN's `Modal` needs no
 * portal, and its `animationType="slide"` is the platform's own version of the
 * `data-[state]:slide-in` rules the web file dropped as dead — so on native the slide is real
 * rather than absent.
 *
 * ESC → `onRequestClose` (Android back), as in the Dialog fork. See that file for the full note on
 * what does and does not carry over.
 *
 * See docs/react-native-tamagui-migration.md §7 step 7.
 */

/** `.sheet` — the panel: full height, pinned to one side by {@link SHEET_VIEWPORT}'s alignment. */
const SHEET_BASE = {
  height: '100%',
  width: '75%', // w-3/4
  maxWidth: '$96', // max-w-sm = 24rem
  backgroundColor: '$background',
  borderColor: '$border',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 20 },
  shadowRadius: 25,
} as const

/** `.sheet--right` — a left edge, pushed to the end of the row. */
const SHEET_RIGHT = { borderLeftWidth: 1 } as const

/** The implicit left side — a right edge. */
const SHEET_LEFT = { borderRightWidth: 1 } as const

/**
 * The row that pins the panel to a side. Web used `position: fixed; right: 0`; RN has no fixed
 * positioning, so the side becomes `justifyContent` on a full-screen row — the same result by the
 * mechanism the platform actually has.
 */
const SHEET_VIEWPORT = { flex: 1, flexDirection: 'row' } as const

const SHEET_BACKDROP = {
  position: 'absolute',
  top: 0, right: 0, bottom: 0, left: 0,
  backgroundColor: 'rgba(0,0,0,0.5)', // ds-lint-ok: bg-black/50 wash, theme-independent
} as const

/** `.sheet__content` — flex column, full height. */
const SHEET_CONTENT = { flexDirection: 'column', height: '100%' } as const

/** `.sheet__header` — row, centred, space-between, px-4, py-3, bottom border. */
const SHEET_HEADER = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: '$4',
  paddingVertical: '$3',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
} as const

type Ctx = { open: boolean; setOpen: (o: boolean) => void }
const SheetContext = React.createContext<Ctx>({ open: false, setOpen: () => {} })

export interface SheetProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Sheet({ open: openProp, defaultOpen = false, onOpenChange, children }: SheetProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolled
  const setOpen = React.useCallback(
    (o: boolean) => { if (openProp === undefined) setUncontrolled(o); onOpenChange?.(o) },
    [openProp, onOpenChange],
  )
  return <SheetContext.Provider value={{ open, setOpen }}>{children}</SheetContext.Provider>
}

function SheetTrigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  const { setOpen } = React.useContext(SheetContext)
  const open = () => setOpen(true)
  if (asChild && React.isValidElement(children)) return React.cloneElement(children as React.ReactElement<any>, { onClick: open })
  return <Prim.Pressable onClick={open} {...props}>{children}</Prim.Pressable>
}

function SheetClose({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  const { setOpen } = React.useContext(SheetContext)
  const close = () => setOpen(false)
  if (asChild && React.isValidElement(children)) return React.cloneElement(children as React.ReactElement<any>, { onClick: close })
  return <Prim.Pressable onClick={close} {...props}>{children}</Prim.Pressable>
}

function SheetContent({
  children,
  side = 'right',
  ...props
}: Record<string, unknown> & { children?: React.ReactNode; side?: 'right' | 'left' }) {
  const { open, setOpen } = React.useContext(SheetContext)
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <NativeView
        {...SHEET_VIEWPORT}
        justifyContent={side === 'right' ? 'flex-end' : 'flex-start'}
        accessibilityViewIsModal
      >
        <NativeView {...SHEET_BACKDROP} onPress={() => setOpen(false)} />
        <NativeView {...SHEET_BASE} {...(side === 'right' ? SHEET_RIGHT : SHEET_LEFT)} {...props}>
          <NativeView {...SHEET_CONTENT}>{children}</NativeView>
        </NativeView>
      </NativeView>
    </Modal>
  )
}

function SheetHeader(props: Record<string, unknown>) {
  return <NativeView {...SHEET_HEADER} {...props} />
}

function SheetTitle({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) return children
  return <Prim.Text {...props}>{children}</Prim.Text>
}

export { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger }

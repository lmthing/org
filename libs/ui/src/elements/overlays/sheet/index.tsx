import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as Prim from '../../primitives/index'

/**
 * Sheet — a side-anchored modal panel, migrated off `@radix-ui/react-dialog` to the universal Tamagui
 * primitives + an open-state context (Part III / B3.4), mirroring the Dialog: portal to body, ESC +
 * backdrop dismiss. Keeps the `sheet*` CSS classes and the compound API. Native takes a `.native.tsx`
 * fork. (No web consumers today; kept as the universal Sheet vocabulary.)
 */

/**
 * `.sheet*` as `$`-token PROPS, transcribed from its retired `styled()` proof
 * (docs/tamagui-idiomatic-migration.md §4). `sheet/index.css` is deleted.
 *
 * Its `transition ease-in-out` + `data-[state]:slide-in/out` rules are dropped, not deferred:
 * nothing has set `data-state` since Radix was removed, so the slide never ran. `.sheet--left` was
 * referenced by this component but never defined in the stylesheet — the left side has always been
 * the unmodified base, which the `side` branch below now makes explicit.
 */
const SHEET_VIEWPORT = { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 } as const

/** `.sheet` — the panel. */
const SHEET_BASE = {
  position: 'fixed',
  top: 0,
  bottom: 0,
  zIndex: 50,
  height: '100%',
  width: '75%', // w-3/4
  maxWidth: '$96', // max-w-sm = 24rem
  backgroundColor: '$background',
  borderColor: '$border',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 20 },
  shadowRadius: 25,
} as const

/** `.sheet--right` — pinned right with a left edge. */
const SHEET_RIGHT = { right: 0, borderLeftWidth: 1 } as const

/** The implicit left side: pinned left with a right edge. */
const SHEET_LEFT = { left: 0, borderRightWidth: 1 } as const

/** `.sheet__content` — flex, flex-col, h-full. */
const SHEET_CONTENT = { display: 'flex', flexDirection: 'column', height: '100%' } as const

/** `.sheet__header` — flex, items-center, justify-between, px-4, py-3, border-b. */
const SHEET_HEADER = {
  display: 'flex',
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

function SheetContent({ children, side = 'right', ...props }: React.HTMLAttributes<HTMLDivElement> & { side?: 'right' | 'left' }) {
  const { open, setOpen } = React.useContext(SheetContext)
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, setOpen])
  if (!open || typeof document === 'undefined') return null
  return ReactDOM.createPortal(
    <Prim.Box {...SHEET_VIEWPORT} role="dialog" aria-modal="true">
      <Prim.Box {...SHEET_VIEWPORT} backgroundColor="rgba(0,0,0,0.5)" onClick={() => setOpen(false)} />
      <Prim.Box {...SHEET_BASE} {...(side === 'right' ? SHEET_RIGHT : SHEET_LEFT)} {...(props as Record<string, unknown>)}>
        <Prim.Box {...SHEET_CONTENT}>{children}</Prim.Box>
      </Prim.Box>
    </Prim.Box>,
    document.body,
  )
}

function SheetHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <Prim.Box {...SHEET_HEADER} {...(props as Record<string, unknown>)} />
}

function SheetTitle({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) return children
  return <Prim.Text as="h2" {...props}>{children}</Prim.Text>
}

export { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger }

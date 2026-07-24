import '@lmthing/css/elements/overlays/sheet/index.css'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'

/**
 * Sheet — a side-anchored modal panel, migrated off `@radix-ui/react-dialog` to the universal Tamagui
 * primitives + an open-state context (Part III / B3.4), mirroring the Dialog: portal to body, ESC +
 * backdrop dismiss. Keeps the `sheet*` CSS classes and the compound API. Native takes a `.native.tsx`
 * fork. (No web consumers today; kept as the universal Sheet vocabulary.)
 */
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

function SheetContent({ className, children, side = 'right', ...props }: React.HTMLAttributes<HTMLDivElement> & { side?: 'right' | 'left' }) {
  const { open, setOpen } = React.useContext(SheetContext)
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, setOpen])
  if (!open || typeof document === 'undefined') return null
  return ReactDOM.createPortal(
    <Prim.Box className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <Prim.Box className="dialog__backdrop" onClick={() => setOpen(false)} />
      <Prim.Box className={cn('sheet', side === 'right' ? 'sheet--right' : 'sheet--left', className)} {...props}>
        <Prim.Box className="sheet__content">{children}</Prim.Box>
      </Prim.Box>
    </Prim.Box>,
    document.body,
  )
}

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <Prim.Box className={cn('sheet__header', className)} {...props} />
}

function SheetTitle({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) return children
  return <Prim.Text as="h2" {...props}>{children}</Prim.Text>
}

export { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger }

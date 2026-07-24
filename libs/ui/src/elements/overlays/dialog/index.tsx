import '@lmthing/css/elements/overlays/dialog/index.css'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'

/**
 * Dialog — a modal, migrated off `@radix-ui/react-dialog` to the universal Tamagui primitives
 * (`Prim.Box`/`Row`/`Text`/`Pressable`) + a tiny open-state context (Part III / B3.4). Reuses the
 * focus-first-on-open / ESC-to-close / backdrop-dismiss pattern already proven in the shipping chat
 * `components/ui/Dialog`, rendered through a `document.body` portal (web) so `position:fixed` escapes any
 * transformed ancestor. Keeps the compound API (Dialog/Trigger/Close/Content/Overlay/Header/Title/
 * Description) and the `dialog*` CSS classes. Behaviour is unit-tested in `dialog.test.tsx`; the native
 * app supplies a `.native.tsx` fork (RN Modal) behind the same names.
 */
type Ctx = { open: boolean; setOpen: (o: boolean) => void }
const DialogContext = React.createContext<Ctx>({ open: false, setOpen: () => {} })

export interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Dialog({ open: openProp, defaultOpen = false, onOpenChange, children }: DialogProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolled
  const setOpen = React.useCallback(
    (o: boolean) => { if (openProp === undefined) setUncontrolled(o); onOpenChange?.(o) },
    [openProp, onOpenChange],
  )
  return <DialogContext.Provider value={{ open, setOpen }}>{children}</DialogContext.Provider>
}

/** Opens the dialog. `asChild` merges onClick onto the single child; else renders a Pressable. */
function DialogTrigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  const { setOpen } = React.useContext(DialogContext)
  const open = () => setOpen(true)
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, { onClick: open })
  }
  return <Prim.Pressable onClick={open} {...props}>{children}</Prim.Pressable>
}

/** Closes the dialog. */
function DialogClose({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  const { setOpen } = React.useContext(DialogContext)
  const close = () => setOpen(false)
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, { onClick: close })
  }
  return <Prim.Pressable onClick={close} {...props}>{children}</Prim.Pressable>
}

function DialogOverlay({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { setOpen } = React.useContext(DialogContext)
  return <Prim.Box className={cn('dialog__backdrop', className)} onClick={() => setOpen(false)} {...props} />
}

function DialogContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen } = React.useContext(DialogContext)
  const ref = React.useRef<HTMLDivElement>(null)

  // Focus the first field only when the dialog opens (not every render — see chat Dialog note).
  React.useEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const preferred = el.querySelector<HTMLElement>('input,textarea,select')
    const fallback = el.querySelector<HTMLElement>('button,[tabindex]:not([tabindex="-1"])')
    ;(preferred ?? fallback)?.focus()
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open || typeof document === 'undefined') return null
  return ReactDOM.createPortal(
    <Prim.Row className="fixed inset-0 z-50 justify-center p-4" alignItems="center" role="dialog" aria-modal="true">
      <DialogOverlay />
      <Prim.Box ref={ref as React.Ref<HTMLElement>} className={cn('dialog', className)} {...props}>
        <Prim.Box className="dialog__content">{children}</Prim.Box>
      </Prim.Box>
    </Prim.Row>,
    document.body,
  )
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <Prim.Box className={cn('dialog__header', className)} {...props} />
}

/** Optional `asChild` renders the child as the title (for a custom Heading); else a Text `<h2>`. */
function DialogTitle({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) return children
  return <Prim.Text as="h2" {...props}>{children}</Prim.Text>
}

function DialogDescription({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) return children
  return <Prim.Text as="p" {...props}>{children}</Prim.Text>
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
}

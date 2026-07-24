import '@lmthing/css/elements/overlays/dropdown/index.css'
import * as React from 'react'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'

/**
 * Dropdown — a menu anchored to its trigger, migrated off `@radix-ui/react-dropdown-menu` to the
 * universal Tamagui primitives + an open-state context (Part III / B3.4). A relatively-positioned
 * wrapper holds an absolutely-positioned `dropdown__content`; open toggles on the trigger, closes on
 * item-select, ESC, or click-outside. Keeps the `dropdown*`/`separator` CSS classes and the compound
 * API. Native takes a `.native.tsx` fork. (No web consumers today; kept as the universal vocabulary.)
 */
type Ctx = { open: boolean; setOpen: (o: boolean) => void }
const DropdownContext = React.createContext<Ctx>({ open: false, setOpen: () => {} })

export interface DropdownProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Dropdown({ open: openProp, defaultOpen = false, onOpenChange, children }: DropdownProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolled
  const setOpen = React.useCallback(
    (o: boolean) => { if (openProp === undefined) setUncontrolled(o); onOpenChange?.(o) },
    [openProp, onOpenChange],
  )
  const rootRef = React.useRef<HTMLDivElement>(null)
  // Close on click-outside the wrapper and on ESC.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, setOpen])
  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <Prim.Box ref={rootRef as React.Ref<HTMLElement>} className="relative inline-block">{children}</Prim.Box>
    </DropdownContext.Provider>
  )
}

function DropdownTrigger({ className, asChild, children, ...props }: { className?: string; asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  const { open, setOpen } = React.useContext(DropdownContext)
  const toggle = () => setOpen(!open)
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, { onClick: toggle, 'aria-expanded': open, 'aria-haspopup': 'menu' })
  }
  return (
    <Prim.Pressable className={cn('dropdown__trigger', className)} aria-expanded={open} aria-haspopup="menu" onClick={toggle} {...props}>
      {children}
    </Prim.Pressable>
  )
}

function DropdownContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open } = React.useContext(DropdownContext)
  if (!open) return null
  return (
    <Prim.Box role="menu" className={cn('dropdown__content absolute z-50', className)} {...props}>
      {children}
    </Prim.Box>
  )
}

function DropdownItem({ className, onClick, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { setOpen } = React.useContext(DropdownContext)
  return (
    <Prim.Pressable
      as="div"
      role="menuitem"
      className={cn('dropdown__item', className)}
      onClick={(e) => { onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>); setOpen(false) }}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    />
  )
}

function DropdownSeparator(props: React.HTMLAttributes<HTMLDivElement>) {
  return <Prim.Box role="separator" className="separator" marginVertical="0.25rem" {...props} />
}

export { Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownSeparator }

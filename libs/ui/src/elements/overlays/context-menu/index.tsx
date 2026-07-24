import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'

/**
 * ContextMenu — a right-click menu, migrated off `@radix-ui/react-context-menu` to the universal
 * Tamagui primitives + an open-state context (Part III / B3.4). The trigger opens the menu at the
 * cursor via `onContextMenu`; the content portals to `document.body` (fixed at the cursor) and closes
 * on select / ESC / click-outside. Exposes a Radix-shaped namespace (`ContextMenu.Root/Trigger/Portal/
 * Content/Item/Separator`) so `import * as ContextMenu` consumers swap with no call-site churn.
 */
type Pt = { x: number; y: number }
type Ctx = { open: boolean; pos: Pt; openAt: (p: Pt) => void; close: () => void }
const MenuContext = React.createContext<Ctx>({ open: false, pos: { x: 0, y: 0 }, openAt: () => {}, close: () => {} })

function Root({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState<Pt>({ x: 0, y: 0 })
  const openAt = React.useCallback((p: Pt) => { setPos(p); setOpen(true) }, [])
  const close = React.useCallback(() => setOpen(false), [])
  React.useEffect(() => {
    if (!open) return
    const onDown = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // Defer so the opening contextmenu event doesn't immediately close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return <MenuContext.Provider value={{ open, pos, openAt, close }}>{children}</MenuContext.Provider>
}

function Trigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  const { openAt } = React.useContext(MenuContext)
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); openAt({ x: e.clientX, y: e.clientY }) }
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, { onContextMenu })
  }
  return <Prim.Box onContextMenu={onContextMenu} {...props}>{children}</Prim.Box>
}

/** Passthrough — the Content self-portals (kept for Radix-shaped call sites). */
function Portal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function Content({ className, children, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open, pos } = React.useContext(MenuContext)
  if (!open || typeof document === 'undefined') return null
  return ReactDOM.createPortal(
    <Prim.Box
      role="menu"
      className={cn(className)}
      style={{ position: 'fixed', top: pos.y, left: pos.x, zIndex: 50, ...style }}
      onMouseDown={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </Prim.Box>,
    document.body,
  )
}

function Item({ className, onClick, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { close } = React.useContext(MenuContext)
  return (
    <Prim.Pressable
      as="div"
      role="menuitem"
      className={cn(className)}
      onClick={(e) => { onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>); close() }}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    >
      {children}
    </Prim.Pressable>
  )
}

function Separator(props: React.HTMLAttributes<HTMLDivElement>) {
  return <Prim.Box role="separator" {...props} />
}

export { Root, Trigger, Portal, Content, Item, Separator }

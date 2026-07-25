import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Dropdown — a menu anchored to its trigger, migrated off `@radix-ui/react-dropdown-menu` to the
 * universal Tamagui primitives + an open-state context (Part III / B3.4). A relatively-positioned
 * wrapper holds an absolutely-positioned `dropdown__content`; open toggles on the trigger, closes on
 * item-select, ESC, or click-outside. Keeps the `dropdown*`/`separator` CSS classes and the compound
 * API. Native takes a `.native.tsx` fork. (No web consumers today; kept as the universal vocabulary.)
 */

/**
 * `.dropdown*` as `$`-token PROPS, transcribed from its retired `styled()` proof
 * (docs/tamagui-idiomatic-migration.md §4). `dropdown/index.css` is deleted.
 *
 * The `data-[state]:animate-in`/`fade`/`zoom` rules are dropped rather than deferred: nothing has
 * set `data-state` since Radix was removed, so they could never match. `data-[disabled]` is the
 * same — the item uses Tamagui's `disabledStyle` instead, which keys off the real `disabled` prop.
 */
const DROPDOWN_ROOT = { position: 'relative', display: 'inline-block' } as const

/** `.dropdown__trigger`. */
const DROPDOWN_TRIGGER = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '$1',
  cursor: 'pointer',
} as const

/** `.dropdown__content` — the popover panel (absolute positioning was inline Tailwind). */
export const DROPDOWN_CONTENT = {
  position: 'absolute',
  zIndex: 50,
  minWidth: '$32',
  overflow: 'hidden',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$popover',
  color: '$popover-foreground',
  padding: '$1',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 4 },
  shadowRadius: 6,
} as const

/** `.dropdown__item`. (`transition-colors` had no matching rule to preserve — hover is instant.) */
export const DROPDOWN_ITEM = {
  position: 'relative',
  display: 'flex',
  cursor: 'pointer',
  userSelect: 'none',
  alignItems: 'center',
  gap: '$2',
  borderRadius: '$radius-sm',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
  fontSize: '$sm',
  color: '$foreground',
  outlineWidth: 0,
  outlineStyle: 'none',
  hoverStyle: { backgroundColor: '$accent', color: '$accent-foreground' },
  disabledStyle: { pointerEvents: 'none', opacity: 0.5 },
} as const

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
      <Prim.Box ref={rootRef as React.Ref<HTMLElement>} {...DROPDOWN_ROOT}>{children}</Prim.Box>
    </DropdownContext.Provider>
  )
}

function DropdownTrigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  const { open, setOpen } = React.useContext(DropdownContext)
  const toggle = () => setOpen(!open)
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, { onClick: toggle, 'aria-expanded': open, 'aria-haspopup': 'menu' })
  }
  return (
    <Prim.Pressable {...DROPDOWN_TRIGGER} aria-expanded={open} aria-haspopup="menu" onClick={toggle} {...(props as Record<string, unknown>)}>
      {children}
    </Prim.Pressable>
  )
}

function DropdownContent({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open } = React.useContext(DropdownContext)
  if (!open) return null
  return (
    <Prim.Box role="menu" {...DROPDOWN_CONTENT} {...(props as Record<string, unknown>)}>
      {children}
    </Prim.Box>
  )
}

function DropdownItem({ onClick, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { setOpen } = React.useContext(DropdownContext)
  return (
    <Prim.Pressable
      as="div"
      role="menuitem"
      {...DROPDOWN_ITEM}
      onClick={(e) => { onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>); setOpen(false) }}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    />
  )
}

function DropdownSeparator(props: React.HTMLAttributes<HTMLDivElement>) {
  return <Prim.Box role="separator" height={1} width="100%" backgroundColor="$border" marginVertical="0.25rem" {...props} />
}

export { Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownSeparator }

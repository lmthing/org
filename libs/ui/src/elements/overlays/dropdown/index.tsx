import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as Prim from '../../primitives/index'
import { DROPDOWN_CONTENT_SHARED, DROPDOWN_ITEM_SHARED } from './styles'

/**
 * Dropdown — a menu anchored to its trigger, migrated off `@radix-ui/react-dropdown-menu` to the
 * universal Tamagui primitives + an open-state context (Part III / B3.4). Open toggles on the
 * trigger, closes on item-select, ESC, or click-outside. Keeps the `dropdown*`/`separator` CSS
 * classes and the compound API. Native takes a `.native.tsx` fork.
 *
 * The panel is PORTALLED to `document.body` and positioned from the trigger's measured rect, rather
 * than absolutely positioned inside a relative wrapper as it was when this had no web consumers.
 *
 * The reason is clipping, not stacking. An absolutely-positioned child is clipped by ANY ancestor
 * with `overflow` other than `visible`, and `z-index` cannot lift it back out — the first real web
 * consumers put menus inside a scrolling sidebar and a horizontally-scrolling tab strip, and every
 * one of those menus rendered underneath its own container, invisible and unclickable, with the
 * correct z-index the whole time. A portal is the only fix that does not constrain where a consumer
 * may put a menu, and `../dialog/index.tsx` already establishes the pattern in this same family.
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
  ...DROPDOWN_CONTENT_SHARED,
  // An RN `View` does not inherit color into its text children, so native omits this.
  color: '$popover-foreground',
} as const

/** `.dropdown__item`. (`transition-colors` had no matching rule to preserve — hover is instant.) */
export const DROPDOWN_ITEM = {
  ...DROPDOWN_ITEM_SHARED,
  position: 'relative',
  display: 'flex',
  cursor: 'pointer',
  userSelect: 'none',
  fontSize: '$sm',
  color: '$foreground',
  outlineWidth: 0,
  outlineStyle: 'none',
  hoverStyle: { backgroundColor: '$accent', color: '$accent-foreground' },
  disabledStyle: { pointerEvents: 'none', opacity: 0.5 },
} as const

type Ctx = {
  open: boolean
  setOpen: (o: boolean) => void
  /** The trigger's box, in viewport coordinates — what the portalled panel anchors to. */
  anchor: DOMRect | null
  setAnchor: (rect: DOMRect | null) => void
}
const DropdownContext = React.createContext<Ctx>({
  open: false,
  setOpen: () => {},
  anchor: null,
  setAnchor: () => {},
})

export interface DropdownProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Dropdown({ open: openProp, defaultOpen = false, onOpenChange, children }: DropdownProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen)
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null)
  const open = openProp ?? uncontrolled
  const setOpen = React.useCallback(
    (o: boolean) => { if (openProp === undefined) setUncontrolled(o); onOpenChange?.(o) },
    [openProp, onOpenChange],
  )
  const rootRef = React.useRef<HTMLDivElement>(null)
  // Close on click-outside and on ESC. The panel is portalled out of `rootRef`, so an "outside"
  // test against the wrapper alone would close the menu on the way to clicking an item — hence
  // the explicit `[role=menu]` check.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[role="menu"]')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // A menu anchored to a measured rect goes stale the moment anything moves, and there is no
    // reasonable way to re-anchor a menu whose trigger has scrolled away — so close instead.
    // `capture` because the scroll usually happens on an inner container, not the window.
    const onScroll = () => setOpen(false)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, setOpen])
  return (
    <DropdownContext.Provider value={{ open, setOpen, anchor, setAnchor }}>
      <Prim.Box ref={rootRef as React.Ref<HTMLElement>} {...DROPDOWN_ROOT}>{children}</Prim.Box>
    </DropdownContext.Provider>
  )
}

function DropdownTrigger({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode } & Record<string, unknown>) {
  const { open, setOpen, setAnchor } = React.useContext(DropdownContext)
  // Measure at click time rather than on mount: a trigger inside a scrolling list moves without
  // re-rendering, so a rect captured earlier would anchor the panel to where the button used to be.
  const toggle = (e: React.MouseEvent) => {
    const el = (e.currentTarget as HTMLElement) ?? null
    setAnchor(el ? el.getBoundingClientRect() : null)
    setOpen(!open)
  }
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, { onClick: toggle, 'aria-expanded': open, 'aria-haspopup': 'menu' })
  }
  return (
    <Prim.Pressable {...DROPDOWN_TRIGGER} aria-expanded={open} aria-haspopup="menu" onClick={toggle} {...(props as Record<string, unknown>)}>
      {children}
    </Prim.Pressable>
  )
}

/** How close to the viewport edge the panel may sit before it is nudged back in. */
const VIEWPORT_MARGIN = 8

/** `DROPDOWN_CONTENT` minus the `right`/`position` a portalled panel sets from the measured anchor. */
const { right: _unusedRight, position: _unusedPosition, ...DROPDOWN_PANEL } = DROPDOWN_CONTENT

/** Gap between the trigger and the panel. */
const ANCHOR_GAP = 4

function DropdownContent({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open, anchor } = React.useContext(DropdownContext)
  const ref = React.useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = React.useState<{ left: number; top: number } | null>(null)

  // The panel's size is content-driven (`width: max-content`), so it has to exist before it can be
  // placed. It is therefore rendered OFF-SCREEN first and moved once measured — in a layout effect,
  // which runs before paint, so nothing is ever drawn in the wrong place.
  React.useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) {
      setPlacement(null)
      return
    }
    const { width, height } = ref.current.getBoundingClientRect()
    // Right-aligned to the trigger: every trigger this component has is a trailing icon button
    // near the right edge of its row, so a panel growing rightward would run off that row.
    let left = anchor.right - width
    let top = anchor.bottom + ANCHOR_GAP
    // Flip above when there is no room below — the common case for a row low in a long list.
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, anchor.top - ANCHOR_GAP - height)
    }
    left = Math.min(left, window.innerWidth - VIEWPORT_MARGIN - width)
    left = Math.max(VIEWPORT_MARGIN, left)
    setPlacement({ left, top })
  }, [open, anchor])

  if (!open || typeof document === 'undefined') return null
  return ReactDOM.createPortal(
    <Prim.Box
      ref={ref as React.Ref<HTMLElement>}
      role="menu"
      {...DROPDOWN_PANEL}
      position="fixed"
      left={placement ? placement.left : -9999}
      top={placement ? placement.top : 0}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </Prim.Box>,
    document.body,
  )
}

function DropdownItem({ onClick, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { setOpen } = React.useContext(DropdownContext)
  return (
    <Prim.Pressable
      as="div"
      role="menuitem"
      {...DROPDOWN_ITEM}
      onClick={(e) => { onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>); setOpen(false) }}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    />
  )
}

function DropdownSeparator(props: React.HTMLAttributes<HTMLDivElement>) {
  return <Prim.Box role="separator" height={1} width="100%" backgroundColor="$border" marginVertical="0.25rem" {...props} />
}

export { Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownSeparator }

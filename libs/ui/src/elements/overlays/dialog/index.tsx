import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as Prim from '../../primitives/index'

/**
 * Dialog — a modal, migrated off `@radix-ui/react-dialog` to the universal Tamagui primitives
 * (`Prim.Box`/`Row`/`Text`/`Pressable`) + a tiny open-state context (Part III / B3.4). Reuses the
 * focus-first-on-open / ESC-to-close / backdrop-dismiss pattern already proven in the shipping chat
 * `components/ui/Dialog`, rendered through a `document.body` portal (web) so `position:fixed` escapes any
 * transformed ancestor. Keeps the compound API (Dialog/Trigger/Close/Content/Overlay/Header/Title/
 * Description) and the `dialog*` CSS classes. Behaviour is unit-tested in `dialog.test.tsx`.
 *
 * **This file is web-only** — the `react-dom` portal is why. `index.native.tsx` is the React Native
 * fork (RN `Modal`, no portal) exporting the same names, including the `DIALOG_*` bags with
 * native-valid values; Metro prefers it. Both are rendered by `libs/ui/metro/suites/overlays.tsx`
 * and the graph gate there fails if this file ever reaches a native bundle.
 */

/**
 * `.dialog*` as `$`-token PROPS, transcribed from its retired `styled()` proof
 * (docs/tamagui-idiomatic-migration.md §4). `dialog/index.css` is deleted.
 *
 * Its `data-[state=open]:animate-in`/`fade-*`/`zoom-*` rules are NOT carried over and did not need
 * the animation driver: **nothing in the repo has set `data-state` since Phase 1 B3.4 removed Radix**,
 * which was what set it. Those selectors could never match, so the rules were dead, not deferred.
 *
 * Shadows are the single-layer approximations from the proof; shadow black follows the codebase's
 * opaque-black-with-alpha convention (theme-independent, so not a token).
 */
export const DIALOG_BACKDROP = {
  position: 'fixed',
  top: 0, right: 0, bottom: 0, left: 0,
  zIndex: 50,
  backgroundColor: 'rgba(0,0,0,0.5)', // ds-lint-ok: bg-black/50 wash, theme-independent
} as const

/** The portal viewport that centres the dialog (was inline Tailwind on a `Prim.Row`). */
const DIALOG_VIEWPORT = {
  position: 'fixed',
  top: 0, right: 0, bottom: 0, left: 0,
  zIndex: 50,
  justifyContent: 'center',
  padding: '$4',
} as const

/** `.dialog` — the panel. Exported so a caller can widen it (see the settings dialog). */
export const DIALOG_BASE = {
  position: 'fixed',
  left: '50%',
  top: '50%',
  zIndex: 50,
  width: '100%',
  maxWidth: 512, // max-w-lg = 32rem (no size token)
  transform: 'translate(-50%, -50%)',
  backgroundColor: '$background',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  padding: '$6',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 10 },
  shadowRadius: 15,
} as const

/** `.dialog__content` — grid, gap-4. */
export const DIALOG_CONTENT = { display: 'grid', gap: '$4' } as const

/** `.dialog__header` — flex, flex-col, gap-2. */
export const DIALOG_HEADER = { display: 'flex', flexDirection: 'column', gap: '$2' } as const

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

function DialogOverlay(props: React.HTMLAttributes<HTMLDivElement>) {
  const { setOpen } = React.useContext(DialogContext)
  return <Prim.Box {...DIALOG_BACKDROP} onClick={() => setOpen(false)} {...(props as Record<string, unknown>)} />
}

function DialogContent({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
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
    <Prim.Row {...DIALOG_VIEWPORT} alignItems="center" role="dialog" aria-modal="true">
      <DialogOverlay />
      <Prim.Box ref={ref as React.Ref<HTMLElement>} {...DIALOG_BASE} {...(props as Record<string, unknown>)}>
        <Prim.Box {...DIALOG_CONTENT}>{children}</Prim.Box>
      </Prim.Box>
    </Prim.Row>,
    document.body,
  )
}

function DialogHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <Prim.Box {...DIALOG_HEADER} {...(props as Record<string, unknown>)} />
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

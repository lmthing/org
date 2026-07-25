import * as React from 'react'
import { Modal } from 'react-native'
import { NativeView } from '../../primitives/_native'
import * as Prim from '../../primitives/index'

/**
 * Dialog (native fork). Same compound API as `index.tsx` — Dialog/Trigger/Close/Overlay/Content/
 * Header/Title/Description plus the exported `DIALOG_*` prop bags — so a surface component is
 * cross-target. Metro prefers this `.native.tsx`; web keeps `index.tsx`.
 *
 * **This file exists because the web one imports `react-dom`.** `index.tsx` renders through
 * `ReactDOM.createPortal(…, document.body)` so `position: fixed` escapes a transformed ancestor.
 * There is no `document` on native and no portal is needed: RN's `Modal` already mounts its
 * children in a host view above the whole app. Until this fork existed, a native bundle resolved
 * the web file and dragged the DOM renderer in — caught by the Metro graph gate in
 * `libs/ui/metro`, which now fails if `react-dom` ever reaches a native bundle again.
 *
 * Three behaviours have no native equivalent and are handled, not silently dropped:
 *
 * - **ESC to close** → `Modal`'s `onRequestClose`, which is Android's hardware back button. That is
 *   the platform's "dismiss" gesture; there is no key event to listen for.
 * - **Focus the first field on open** → not carried over. It is a `querySelector('input,…')` walk
 *   over the DOM; RN's analogue (`AccessibilityInfo.setAccessibilityFocus` against a measured node)
 *   is a different feature, and a wrong guess at it would be worse than the honest omission.
 * - **`position: fixed` + `translate(-50%, -50%)` centring** → the Modal's viewport centres the panel
 *   with flex, which is how RN centres things. See `DIALOG_BASE` below.
 *
 * See docs/react-native-tamagui-migration.md §7 step 7.
 */

/**
 * The `DIALOG_*` bags, native-valid. Same NAMES as the web file because surfaces spread them onto a
 * primitive (`studio/space/space-list`, `save-agent-modal`, `knowledge/field/new-folder-modal`, …)
 * and that import must resolve on both targets.
 *
 * Same names, not same values — RN has no `position: 'fixed'`, no `display: 'grid'` and no
 * `transform: 'translate(%)'`. Each is replaced by its native equivalent rather than passed through
 * as a value Tamagui would drop on the floor.
 */
export const DIALOG_BACKDROP = {
  position: 'absolute',
  top: 0, right: 0, bottom: 0, left: 0,
  zIndex: 50,
  backgroundColor: 'rgba(0,0,0,0.5)', // ds-lint-ok: bg-black/50 wash, theme-independent
} as const

/** `.dialog` — the panel. Centred by {@link DIALOG_VIEWPORT}, so it carries no positioning itself. */
export const DIALOG_BASE = {
  width: '100%',
  maxWidth: 512, // max-w-lg = 32rem (no size token)
  backgroundColor: '$background',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  padding: '$6',
  shadowColor: 'rgba(0,0,0,0.1)', // ds-lint-ok: shadow alpha-black
  shadowOffset: { width: 0, height: 10 },
  shadowRadius: 15,
} as const

/** `.dialog__content` — `display: grid` has no native analogue; a flex column with the same gap does. */
export const DIALOG_CONTENT = { gap: '$4' } as const

/** `.dialog__header` — flex column, gap-2 (RN views are already column). */
export const DIALOG_HEADER = { flexDirection: 'column', gap: '$2' } as const

/** Centres the panel inside the Modal — the native replacement for the fixed/translate trick. */
const DIALOG_VIEWPORT = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$4',
} as const

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

/**
 * Opens the dialog. Identical to web, `asChild` included: the native `Pressable` fork maps `onClick`
 * onto RN's `onPress`, so cloning a child with `onClick` is still the right merge on this target.
 */
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

/**
 * The dismissing backdrop. `NativeView` rather than `Prim.Box` because this file needs `onPress` —
 * see `primitives/_native` for why the public primitives cannot type it inside a `.native.tsx`.
 */
function DialogOverlay(props: Record<string, unknown>) {
  const { setOpen } = React.useContext(DialogContext)
  return <NativeView {...DIALOG_BACKDROP} onPress={() => setOpen(false)} {...props} />
}

function DialogContent({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) {
  const { open, setOpen } = React.useContext(DialogContext)
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      // Android's back button. The web file's ESC listener has no counterpart to bind here.
      onRequestClose={() => setOpen(false)}
    >
      <NativeView {...DIALOG_VIEWPORT} accessibilityViewIsModal accessibilityRole="none">
        <DialogOverlay />
        <NativeView {...DIALOG_BASE} {...props}>
          <NativeView {...DIALOG_CONTENT}>{children}</NativeView>
        </NativeView>
      </NativeView>
    </Modal>
  )
}

function DialogHeader(props: Record<string, unknown>) {
  return <NativeView {...DIALOG_HEADER} {...props} />
}

/** `as="h2"` is web-only and ignored by the Text fork; the element stays a native Text. */
function DialogTitle({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) return children
  return <Prim.Text {...props}>{children}</Prim.Text>
}

function DialogDescription({ asChild, children, ...props }: { asChild?: boolean; children?: React.ReactNode } & Record<string, unknown>) {
  if (asChild && React.isValidElement(children)) return children
  return <Prim.Text {...props}>{children}</Prim.Text>
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

/**
 * dialog.styled.tsx — P2 conversion of the `.dialog` BEM block CHROME
 * (docs/tamagui-idiomatic-migration.md §4). Overlay chrome only; the interactive overlay moves to
 * @tamagui/dialog in P4. This converts libs/css/src/elements/overlays/dialog/index.css — the
 * `.dialog__backdrop`, the centered `.dialog` panel, `.dialog__content` and `.dialog__header` — into
 * idiomatic Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors and SPIKE-B scales.
 *
 * All `data-[state=…]:animate-in/out`, `fade-*` and `zoom-*` utilities await the animation driver
 * (§5/P4) and are omitted. Lands alongside the shipped className dialog (index.tsx), which keeps its
 * behaviour test (index.test.tsx); dialog-styled.test.tsx pins these frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

// shadow-lg ≈ opaque-black at low alpha, offset down, wide blur (single-layer approximation, §5).
const shadowLg = { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 10 }, shadowRadius: 15 } as const

/**
 * `.dialog__backdrop` — fixed inset-0 z-50 bg-black/50 (animate-in/out + fade → animation driver,
 * §5/P4). `bg-black/50` is an opaque-black-with-alpha wash → compact rgba(0,0,0,0.5).
 */
export const OverlayDialogBackdropFrame = styled(View, {
  name: 'OverlayDialogBackdrop',
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 50,
  backgroundColor: 'rgba(0,0,0,0.5)',
  // data-[state]:animate-in/out + fade-in/out await the animation driver (§5/P4)
})

/**
 * `.dialog` — fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-1/2 bg-background rounded-lg
 * border shadow-lg p-6 (animate/zoom → animation driver, §5/P4). max-w-lg (32rem/512px) has no size
 * token — literal 512.
 */
export const OverlayDialogFrame = styled(View, {
  name: 'OverlayDialog',
  position: 'fixed',
  left: '50%',
  top: '50%',
  zIndex: 50,
  width: '100%',
  maxWidth: 512, // max-w-lg = 32rem = 512px (no size token)
  transform: 'translate(-50%, -50%)', // -translate-x-1/2 -translate-y-1/2
  backgroundColor: '$background',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  padding: '$6',
  ...shadowLg,
  // data-[state]:animate-in/out + fade + zoom-95 await the animation driver (§5/P4)
})

/** `.dialog__content` — grid! gap-4. */
export const OverlayDialogContentFrame = styled(View, {
  name: 'OverlayDialogContent',
  display: 'grid',
  gap: '$4',
})

/** `.dialog__header` — flex! flex-col gap-2. */
export const OverlayDialogHeaderFrame = styled(View, {
  name: 'OverlayDialogHeader',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

export interface StyledOverlayDialogProps extends React.ComponentProps<'div'> {}

const Frame = OverlayDialogFrame as unknown as React.ComponentType<any>

/** Idiomatic OverlayDialog chrome frame — the centered panel (P4 wires interactivity via @tamagui/dialog). */
export function StyledOverlayDialog({ ...props }: StyledOverlayDialogProps) {
  return <Frame {...props} />
}

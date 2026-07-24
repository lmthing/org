/**
 * sheet.styled.tsx — P2 conversion of the `.sheet` BEM block CHROME
 * (docs/tamagui-idiomatic-migration.md §4). Overlay chrome only; the interactive overlay moves to
 * @tamagui/sheet in P4. This converts libs/css/src/elements/overlays/sheet/index.css — the fixed
 * `.sheet` panel (+ the `--right` edge modifier), its `.sheet__content` column and `.sheet__header`
 * bar — into idiomatic Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors and
 * SPIKE-B scales.
 *
 * All `transition ease-in-out`, `duration-300`, `data-[state=…]:animate-in/out` and `slide-*`
 * utilities await the animation driver (§5/P4) and are omitted. Lands alongside the shipped className
 * sheet (index.tsx), which keeps its behaviour test (index.test.tsx); sheet-styled.test.tsx pins these
 * frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

// shadow-xl ≈ opaque-black at low alpha, large offset, very wide blur (single-layer approximation, §5).
const shadowXl = { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 20 }, shadowRadius: 25 } as const

/**
 * `.sheet` — fixed inset-y-0 z-50 h-full w-3/4 max-w-sm bg-background border-border shadow-xl
 * (transition/animate/duration → animation driver, §5/P4). `.sheet--right` (right-0 border-l + slide)
 * becomes a boolean `right` variant (slide → animation driver). w-3/4 → 75%; max-w-sm (24rem) → $96.
 */
export const OverlaySheetFrame = styled(View, {
  name: 'OverlaySheet',
  position: 'fixed',
  top: 0, // inset-y-0
  bottom: 0,
  zIndex: 50,
  height: '100%',
  width: '75%', // w-3/4
  maxWidth: '$96', // max-w-sm = 24rem = 384px = $96
  backgroundColor: '$background',
  borderColor: '$border',
  ...shadowXl,
  // transition ease-in-out + data-[state]:animate-in/out duration-300 await the animation driver (§5/P4)

  variants: {
    right: {
      true: {
        right: 0,
        borderLeftWidth: 1,
        // data-[state]:slide-in/out-from/to-right awaits the animation driver (§5/P4)
      },
    },
  } as const,
})

/** `.sheet__content` — flex! flex-col h-full. */
export const OverlaySheetContentFrame = styled(View, {
  name: 'OverlaySheetContent',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
})

/** `.sheet__header` — flex! items-center justify-between px-4 py-3 border-b border-border. */
export const OverlaySheetHeaderFrame = styled(View, {
  name: 'OverlaySheetHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: '$4',
  paddingVertical: '$3',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

export interface StyledOverlaySheetProps extends React.ComponentProps<'div'> {
  right?: boolean
}

const Frame = OverlaySheetFrame as unknown as React.ComponentType<any>

/** Idiomatic OverlaySheet chrome frame — the fixed panel (P4 wires interactivity via @tamagui/sheet). */
export function StyledOverlaySheet({ right, ...props }: StyledOverlaySheetProps) {
  return <Frame right={right} {...props} />
}

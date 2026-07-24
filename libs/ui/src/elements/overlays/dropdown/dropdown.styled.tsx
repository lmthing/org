/**
 * dropdown.styled.tsx — P2 conversion of the `.dropdown` BEM block CHROME
 * (docs/tamagui-idiomatic-migration.md §4). Overlay chrome only; the interactive overlay moves to
 * @tamagui/popover in P4. This converts libs/css/src/elements/overlays/dropdown/index.css — the
 * `.dropdown` anchor, `.dropdown__trigger`, the `.dropdown__content` popover surface and its
 * `.dropdown__item` rows — into idiomatic Tamagui `styled()` frames using the SPIKE-A1 var-backed
 * `$` colors and SPIKE-B scales.
 *
 * All `data-[state=…]:animate-in/out`, `fade-*`, `zoom-*` and `transition-colors` utilities await the
 * animation driver (§5/P4) and are omitted. `data-[disabled]` styling maps to `disabledStyle`. Lands
 * alongside the shipped className dropdown (index.tsx), which keeps its behaviour test (index.test.tsx);
 * dropdown-styled.test.tsx pins these frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

// shadow-md ≈ opaque-black at low alpha, small offset, medium blur (single-layer approximation, §5).
const shadowMd = { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 4 }, shadowRadius: 6 } as const

/** `.dropdown` — relative. */
export const OverlayDropdownFrame = styled(View, {
  name: 'OverlayDropdown',
  position: 'relative',
})

/** `.dropdown__trigger` — inline-flex! items-center gap-1 cursor-pointer. */
export const OverlayDropdownTriggerFrame = styled(View, {
  name: 'OverlayDropdownTrigger',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '$1',
  cursor: 'pointer',
})

/**
 * `.dropdown__content` — z-50 min-w-32 overflow-hidden rounded-md border bg-popover
 * text-popover-foreground shadow-md p-1 (animate/fade/zoom → animation driver, §5/P4).
 */
export const OverlayDropdownContentFrame = styled(View, {
  name: 'OverlayDropdownContent',
  zIndex: 50,
  minWidth: '$32',
  overflow: 'hidden',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$popover',
  color: '$popover-foreground',
  padding: '$1',
  ...shadowMd,
  // data-[state]:animate-in/out + fade + zoom-95 await the animation driver (§5/P4)
})

/**
 * `.dropdown__item` — relative flex! cursor-pointer select-none items-center gap-2 rounded-sm px-2
 * py-1.5 text-sm text-foreground outline-none + hover:bg-accent; data-[disabled] → disabledStyle
 * (pointer-events-none opacity-50). transition-colors → animation driver (§5/P4).
 */
export const OverlayDropdownItemFrame = styled(View, {
  name: 'OverlayDropdownItem',
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
  outlineWidth: 0, // outline-none
  outlineStyle: 'none',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: '$accent', color: '$accent-foreground' },
  disabledStyle: { pointerEvents: 'none', opacity: 0.5 },
})

export interface StyledOverlayDropdownProps extends React.ComponentProps<'div'> {}

const Frame = OverlayDropdownFrame as unknown as React.ComponentType<any>

/** Idiomatic OverlayDropdown chrome frame — the anchor (P4 wires interactivity via @tamagui/popover). */
export function StyledOverlayDropdown({ ...props }: StyledOverlayDropdownProps) {
  return <Frame {...props} />
}

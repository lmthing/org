/**
 * select.styled.tsx — P2 leaf conversion of the `.select` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/forms/select/index.css —
 * the `.select` wrapper, `.select__trigger` and `.select__content` — into idiomatic Tamagui
 * `styled()` frames using the SPIKE-A1 var-backed `$` colors and SPIKE-B Tailwind scales.
 *
 * `.select__content` carries the `animate-in fade-in-0 zoom-in-95` entrance; the static box is
 * converted here, the animation awaits the animation-driver step (§5/P4), so it is documented rather
 * than expressed. The shipped Select (index.tsx) renders a native `<select>`, so only the wrapper +
 * trigger are on the render path today; the content frame is kept for CSS-faithful deletion later.
 *
 * Lands alongside the shipped className Select (index.tsx); select-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/** `.select` — the positioning wrapper (`relative`). */
export const SelectFrame = styled(View, {
  name: 'Select',
  position: 'relative',
})

/**
 * `.select__trigger` — flex, h-9, w-full, items-center, justify-between, rounded-md, border-input,
 * bg-background, px-3, py-2, text-sm, placeholder muted-foreground, `focus:` ring, disabled 50%.
 */
export const SelectTriggerFrame = styled(View, {
  name: 'SelectTrigger',
  tag: 'select',
  display: 'flex',
  height: '$9',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$input',
  backgroundColor: '$background',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  fontSize: '$sm',
  placeholderTextColor: '$muted-foreground',
  // focus:outline-none focus:ring-2 focus:ring-ring — `.select` uses `focus:`, not `focus-visible:`.
  focusStyle: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$ring' },
  disabledStyle: { opacity: 0.5, cursor: 'not-allowed' },
})

/**
 * `.select__content` — the floating listbox: absolute, z-50, min-w-full, overflow-hidden, rounded-md,
 * border-border, bg-popover, text-popover-foreground, shadow-md. (Tailwind `z-50` has no named zIndex
 * token, so the literal 50 is used.) `animate-in fade-in-0 zoom-in-95` awaits the animation driver.
 */
export const SelectContentFrame = styled(View, {
  name: 'SelectContent',
  position: 'absolute',
  zIndex: 50,
  minWidth: '100%',
  overflow: 'hidden',
  borderRadius: '$radius-md',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$popover',
  color: '$popover-foreground',
  // shadow-md — single-layer approximation (harness reconciles pixels). Shadow black matches the
  // codebase's CSS convention (opaque-black-with-alpha), theme-independent.
  shadowColor: 'rgba(0,0,0,0.1)',
  shadowOffset: { width: 0, height: 4 },
  shadowRadius: 6,
})

export interface StyledSelectProps extends React.ComponentProps<'select'> {}

const Wrapper = SelectFrame as unknown as React.ComponentType<any>
const Trigger = SelectTriggerFrame as unknown as React.ComponentType<any>

/** Idiomatic Select — same public shape as the shipped className Select (native `<select>` trigger). */
export function StyledSelect({ children, ...props }: StyledSelectProps) {
  return (
    <Wrapper>
      <Trigger {...props}>{children}</Trigger>
    </Wrapper>
  )
}

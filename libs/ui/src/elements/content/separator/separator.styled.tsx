/**
 * separator.styled.tsx — P2 leaf conversion of the `.separator` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/content/separator/index.css
 * — the `.separator` base + `.separator--vertical` — into ONE `styled(View, { variants })` using the
 * SPIKE-A1 var-backed `$` colors.
 *
 * Lands alongside the shipped className Separator (index.tsx); separator-styled.test.tsx pins it.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.separator` base (h-px, w-full, bg-border) + the `vertical` variant (`.separator--vertical` =
 * h-full, w-px). The Tailwind `block!` display is the default box display; no reset is needed here.
 */
export const SeparatorFrame = styled(View, {
  name: 'Separator',
  height: 1, // h-px
  width: '100%', // w-full
  backgroundColor: '$border',

  variants: {
    vertical: {
      true: { height: '100%', width: 1 }, // h-full w-px
    },
  } as const,
})

export interface StyledSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  vertical?: boolean
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
}

const Frame = SeparatorFrame as unknown as React.ComponentType<any>

/** Idiomatic Separator — same public API as the shipped className Separator (`vertical`/`orientation`). */
export function StyledSeparator({ vertical, orientation, decorative = true, ...props }: StyledSeparatorProps) {
  const isVertical = vertical || orientation === 'vertical'
  return (
    <Frame
      role={decorative ? 'none' : 'separator'}
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      vertical={isVertical}
      {...props}
    />
  )
}

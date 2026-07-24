/**
 * stack.styled.tsx — P2 composite conversion of the `.stack` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/layouts/stack/index.css —
 * the `.stack` base + `.stack--row` and the `.stack--gap-sm/md/lg` — into ONE `styled(View, { variants })`.
 *
 * Lands alongside the shipped className Stack (index.tsx); stack-styled.test.tsx pins the variants.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.stack` base (flex, flex-col) + the `row` variant (`.stack--row` = flex-row) + the `gap` variant
 * (`.stack--gap-sm/md/lg` = gap-1/3/6, SPIKE-B space tokens).
 */
export const StackFrame = styled(View, {
  name: 'Stack',
  display: 'flex',
  flexDirection: 'column',

  variants: {
    row: {
      true: { flexDirection: 'row' },
    },
    gap: {
      sm: { gap: '$1' },
      md: { gap: '$3' },
      lg: { gap: '$6' },
    },
  } as const,
})

export type StackGap = 'sm' | 'md' | 'lg'

export interface StyledStackProps extends React.ComponentProps<'div'> {
  row?: boolean
  gap?: StackGap
}

const Frame = StackFrame as unknown as React.ComponentType<any>

/** Idiomatic Stack — same public API as the shipped className Stack (`row`/`gap`). */
export function StyledStack({ row, gap, ...props }: StyledStackProps) {
  return <Frame row={row} gap={gap} {...props} />
}

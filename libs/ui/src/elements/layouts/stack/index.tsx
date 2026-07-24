import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Stack — the idiomatic `.stack`. Renders `Prim.Box` (a real `<div>` at runtime via
 * `createComponent`) with the `.stack` styling as `$`-token PROPS from the stack.styled.tsx variant
 * table (docs/tamagui-idiomatic-migration.md §4). `stack/index.css` is deleted.
 */
export type StackGap = 'sm' | 'md' | 'lg'

export interface StackProps extends React.ComponentProps<'div'> {
  row?: boolean
  gap?: StackGap
}

/** `.stack--gap-sm/md/lg` → gap-1/3/6 on the SPIKE-B `$space` scale. */
const GAP: Record<StackGap, string> = { sm: '$1', md: '$3', lg: '$6' }

function Stack({ row, gap, ...props }: StackProps) {
  return (
    <Prim.Box
      display="flex"
      flexDirection={row ? 'row' : 'column'}
      {...(gap ? { gap: GAP[gap] } : {})}
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Stack }

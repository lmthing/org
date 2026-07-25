import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Stack — the idiomatic `.stack`. Renders `Prim.Box` (a real `<div>` at runtime via
 * `createComponent`) with the `.stack` styling as `$`-token PROPS from its retired `styled()` proof variant
 * table (docs/tamagui-idiomatic-migration.md §4). `stack/index.css` is deleted.
 */
export type StackGap = 'sm' | 'md' | 'lg'

// `Prim.BoxProps`, not `ComponentProps<'div'>` — see the note on `Caption`/`Heading`.
export interface StackProps extends Omit<Prim.BoxProps, 'gap'> {
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
      {...props}
    />
  )
}

export { Stack }

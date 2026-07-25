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
  /**
   * One of the three semantic keys, OR any value `Prim.Box` accepts (`$4`, `12`, `'0.5rem'`), which
   * passes straight through. The pass-through is not a convenience — the `style-bags-to-props`
   * codemod emits bags carrying the retired CSS class's literal `gap` (`{gap: '0.5rem'}`) and those
   * bags are spread AFTER a semantic `gap="sm"`, so the literal wins the merge and arrives here.
   * Looking it up in `GAP` regardless returned `undefined` and DROPPED the gap. Pinned in the tests.
   */
  gap?: StackGap | number | string
}

/** `.stack--gap-sm/md/lg` → gap-1/3/6 on the SPIKE-B `$space` scale. */
const GAP: Record<StackGap, string> = { sm: '$1', md: '$3', lg: '$6' }

const isSemanticGap = (gap: unknown): gap is StackGap =>
  gap === 'sm' || gap === 'md' || gap === 'lg'

function Stack({ row, gap, ...props }: StackProps) {
  return (
    <Prim.Box
      display="flex"
      flexDirection={row ? 'row' : 'column'}
      {...(gap !== undefined ? { gap: isSemanticGap(gap) ? GAP[gap] : gap } : {})}
      {...props}
    />
  )
}

export { Stack }

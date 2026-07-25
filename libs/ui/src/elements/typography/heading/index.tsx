import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Heading — the idiomatic `.heading-{level}`. Renders `Prim.Text` as a real `<h1..h4>` (runtime tag
 * via `createComponent`) with the styling as `$`-token PROPS transcribed from its retired `styled()` proof. CSS deleted.
 */
export type HeadingLevel = 1 | 2 | 3 | 4

// `Prim.TextProps`, not `HTMLAttributes`: the rest props are spread straight onto `Prim.Text`, so
// style props already work at runtime — the narrow type was what stopped callers using them, and
// what forced the `as Record<string, unknown>` cast below. Same fix as `Caption`.
export interface HeadingProps extends Omit<Prim.TextProps, 'as'> {
  level?: HeadingLevel
  muted?: boolean
}

const LEVEL_SIZE: Record<HeadingLevel, string> = { 1: '$3xl', 2: '$2xl', 3: '$xl', 4: '$base' }

function Heading({ level = 2, muted, children, ...props }: HeadingProps) {
  return (
    <Prim.Text
      as={`h${level}` as 'h1' | 'h2' | 'h3' | 'h4'}
      fontWeight="$semibold"
      letterSpacing="$tight"
      fontSize={LEVEL_SIZE[level]}
      color={muted ? '$muted-foreground' : '$foreground'}
      {...props}
    >
      {children}
    </Prim.Text>
  )
}

export { Heading }

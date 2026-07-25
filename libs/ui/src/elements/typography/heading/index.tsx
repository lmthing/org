import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Heading — the idiomatic `.heading-{level}`. Renders `Prim.Text` as a real `<h1..h4>` (runtime tag
 * via `createComponent`) with the styling as `$`-token PROPS transcribed from its retired `styled()` proof. CSS deleted.
 */
export type HeadingLevel = 1 | 2 | 3 | 4

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
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
      {...(props as Record<string, unknown>)}
    >
      {children}
    </Prim.Text>
  )
}

export { Heading }

import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Code — the idiomatic `.code-inline` / `.code-block`. Renders `Prim.Text` as a real `<code>` / `<pre>`
 * (runtime tags via `createComponent`) with the styling as `$`-token PROPS transcribed from its retired `styled()` proof.
 * CSS deleted.
 */
// `Prim.TextProps`, not `ComponentProps<'code'>` — see the note on `Caption`/`Heading`.
export interface CodeProps extends Omit<Prim.TextProps, 'as'> {
  block?: boolean
}

function Code({ block, children, ...props }: CodeProps) {
  if (block) {
    return (
      <Prim.Text
        as="pre"
        display="block"
        fontFamily="$mono"
        fontSize="$sm"
        backgroundColor="$muted"
        padding="$4"
        borderRadius="$radius-md"
        overflowX="auto"
        color="$foreground"
        lineHeight={1.625}
      >
        <Prim.Text as="code" {...props}>{children}</Prim.Text>
      </Prim.Text>
    )
  }
  return (
    <Prim.Text
      as="code"
      fontFamily="$mono"
      fontSize="$sm"
      backgroundColor="$muted"
      paddingHorizontal="$1.5"
      paddingVertical="$0.5"
      borderRadius="$radius"
      color="$foreground"
      {...props}
    >
      {children}
    </Prim.Text>
  )
}

export { Code }

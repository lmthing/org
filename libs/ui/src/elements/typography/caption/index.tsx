import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Caption — the idiomatic `.caption`. Renders `Prim.Text` (real `<span>`) with the styling as
 * `$`-token PROPS from caption.styled.tsx. `muted` uses the `/70` alpha via web color-mix. CSS deleted.
 */
export interface CaptionProps extends React.ComponentProps<'span'> {
  muted?: boolean
}

function Caption({ muted, ...props }: CaptionProps) {
  return (
    <Prim.Text
      fontSize="$xs"
      color={muted ? 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)' : '$muted-foreground'}
      lineHeight={1.375}
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Caption }

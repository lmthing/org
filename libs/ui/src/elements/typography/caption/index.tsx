import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Caption — the idiomatic `.caption`. Renders `Prim.Text` (real `<span>`) with the styling as
 * `$`-token PROPS transcribed from its retired `styled()` proof. `muted` uses the `/70` alpha via web color-mix. CSS deleted.
 */
// `Prim.TextProps`, not `ComponentProps<'span'>`: the rest props are spread straight onto
// `Prim.Text`, so idiomatic style props already WORK here at runtime — the narrower type was the
// only thing stopping a caller (and the codemod) from writing them.
export interface CaptionProps extends Prim.TextProps {
  muted?: boolean
}

function Caption({ muted, ...props }: CaptionProps) {
  return (
    <Prim.Text
      fontSize="$xs"
      color={muted ? 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)' : '$muted-foreground'}
      // A bare number here compiles to `1.375px` (not a unitless ×1.375 multiplier) under this
      // component's styling engine, which appends `px` to any raw number regardless of property —
      // unlike a browser's own unitless-lineHeight allowance. `em` keeps the same visual ratio
      // (relative to Caption's own font-size) while resolving correctly.
      lineHeight="1.375em"
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Caption }

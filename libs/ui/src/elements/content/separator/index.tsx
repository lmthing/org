import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Separator — the idiomatic `.separator`, a themed rule. Renders `Prim.Box` (a real
 * `<div role="separator">`) styled by `$`-token PROPS transcribed from its retired `styled()` proof. CSS deleted.
 */
export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  vertical?: boolean
  orientation?: 'horizontal' | 'vertical'
  /** Decorative (default) separators are hidden from a11y; a semantic one keeps role="separator". */
  decorative?: boolean
}

function Separator({ vertical, orientation, decorative = true, ...props }: SeparatorProps) {
  const isVertical = vertical || orientation === 'vertical'
  return (
    <Prim.Box
      role={decorative ? 'none' : 'separator'}
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      backgroundColor="$border"
      {...(isVertical ? { height: '100%', width: 1 } : { height: 1, width: '100%' })}
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Separator }

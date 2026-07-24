import '@lmthing/css/elements/content/separator/index.css'
import * as React from 'react'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'

/**
 * Separator — a themed rule. Migrated off `@radix-ui/react-separator` to the universal Tamagui `Box`
 * (Part III / B3.4): a Radix Separator.Root is just a `<div role="separator" aria-orientation>`, which
 * `Prim.Box` reproduces exactly — and being a Tamagui primitive it renders on native via the Box fork.
 * Keeps the `separator` CSS classes and the `vertical`/`orientation` API.
 */
export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  vertical?: boolean
  orientation?: 'horizontal' | 'vertical'
  /** Decorative (default) separators are hidden from a11y; a semantic one keeps role="separator". */
  decorative?: boolean
}

function Separator({ className, vertical, orientation, decorative = true, ...props }: SeparatorProps) {
  const isVertical = vertical || orientation === 'vertical'
  return (
    <Prim.Box
      role={decorative ? 'none' : 'separator'}
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      className={cn('separator', isVertical && 'separator--vertical', className)}
      {...props}
    />
  )
}

export { Separator }

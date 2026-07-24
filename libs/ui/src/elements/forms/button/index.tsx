import '@lmthing/css/elements/forms/button/index.css'
import * as React from 'react'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'

/**
 * Button — the styled `.btn`. Migrated off `@radix-ui/react-slot` to the universal Tamagui `Pressable`
 * (Part III / B3.4). `asChild` is handled by a tiny local slot that merges the `btn*` className onto the
 * caller's single child (the only thing the codebase used Slot for) instead of pulling in Radix.
 */
export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'destructive'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}

function Button({ className, variant = 'primary', size = 'default', asChild = false, children, ...props }: ButtonProps) {
  const cls = cn(
    'btn',
    variant === 'primary' && 'btn--primary',
    variant === 'ghost' && 'btn--ghost',
    variant === 'outline' && 'btn--outline',
    variant === 'destructive' && 'btn--destructive',
    size === 'sm' && 'btn--sm',
    size === 'lg' && 'btn--lg',
    size === 'icon' && 'btn--icon',
    className,
  )
  // asChild: render the caller's element, merging our className/props onto it (local Slot).
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<any>
    return React.cloneElement(child, {
      ...props,
      className: cn(cls, child.props.className),
    })
  }
  return <Prim.Pressable className={cls} {...(props as React.HTMLAttributes<HTMLElement>)}>{children}</Prim.Pressable>
}

export { Button }

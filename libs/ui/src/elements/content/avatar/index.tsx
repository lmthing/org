import '@lmthing/css/elements/content/avatar/index.css'
import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '../../../lib/utils'
import { spectrumColor } from '../../../lib/spectrum'

export type AvatarSize = 'default' | 'sm' | 'lg'

export interface AvatarProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
  size?: AvatarSize
}

function Avatar({ className, size = 'default', ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'avatar',
        size === 'sm' && 'avatar--sm',
        size === 'lg' && 'avatar--lg',
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      className={cn('avatar__image', className)}
      {...props}
    />
  )
}

export interface AvatarFallbackProps
  extends React.ComponentProps<typeof AvatarPrimitive.Fallback> {
  /**
   * When set, tints the fallback with a stable rainbow color derived from this
   * key (e.g. a user/space id) for the full-spectrum look.
   */
  colorKey?: string
}

function AvatarFallback({ className, colorKey, style, ...props }: AvatarFallbackProps) {
  const tint = colorKey
    ? (() => {
        const c = spectrumColor(colorKey)
        return { backgroundColor: `color-mix(in srgb, ${c} 22%, transparent)`, color: c, ...style }
      })()
    : style
  return (
    <AvatarPrimitive.Fallback
      className={cn('avatar__fallback', className)}
      style={tint}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }

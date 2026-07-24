import '@lmthing/css/elements/content/avatar/index.css'
import * as React from 'react'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'
import { spectrumColor } from '../../../lib/spectrum'

/**
 * Avatar — image with a graceful fallback. Migrated off `@radix-ui/react-avatar` to the universal
 * Tamagui primitives (`Box`/`Image`) + a tiny load-state context (Part III / B3.4), reproducing Radix's
 * behaviour: the fallback shows until the image reports `load`, and stays if it `error`s. Renders on
 * native via the Box/Image forks. Keeps the `avatar*` CSS classes and the Root/Image/Fallback API.
 */
export type AvatarSize = 'default' | 'sm' | 'lg'
type Status = 'idle' | 'loaded' | 'error'
const AvatarContext = React.createContext<{ status: Status; setStatus: (s: Status) => void }>({
  status: 'idle',
  setStatus: () => {},
})

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: AvatarSize
}

function Avatar({ className, size = 'default', ...props }: AvatarProps) {
  const [status, setStatus] = React.useState<Status>('idle')
  return (
    <AvatarContext.Provider value={{ status, setStatus }}>
      <Prim.Box
        className={cn('avatar', size === 'sm' && 'avatar--sm', size === 'lg' && 'avatar--lg', className)}
        {...props}
      />
    </AvatarContext.Provider>
  )
}

function AvatarImage({ className, onLoad, onError, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { status, setStatus } = React.useContext(AvatarContext)
  // Hidden (but still fetching) until the image successfully loads — same visible result as Radix.
  return (
    <Prim.Image
      className={cn('avatar__image', className)}
      style={status === 'loaded' ? undefined : { display: 'none' }}
      onLoad={(e) => { setStatus('loaded'); onLoad?.(e) }}
      onError={(e) => { setStatus('error'); onError?.(e) }}
      {...props}
    />
  )
}

export interface AvatarFallbackProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * When set, tints the fallback with a stable rainbow color derived from this
   * key (e.g. a user/space id) for the full-spectrum look.
   */
  colorKey?: string
}

function AvatarFallback({ className, colorKey, style, ...props }: AvatarFallbackProps) {
  const { status } = React.useContext(AvatarContext)
  if (status === 'loaded') return null
  const tint = colorKey
    ? (() => {
        const c = spectrumColor(colorKey)
        return { backgroundColor: `color-mix(in srgb, ${c} 22%, transparent)`, color: c, ...style }
      })()
    : style
  return <Prim.Box className={cn('avatar__fallback', className)} style={tint} {...props} />
}

export { Avatar, AvatarImage, AvatarFallback }

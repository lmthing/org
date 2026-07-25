import * as React from 'react'
import * as Prim from '../../primitives/index'
import { spectrumColor } from '../../../lib/spectrum'

/**
 * Avatar — image with a graceful fallback. Migrated off `@radix-ui/react-avatar` to the universal
 * Tamagui primitives (`Box`/`Image`) + a tiny load-state context (Part III / B3.4), reproducing
 * Radix's behaviour: the fallback shows until the image reports `load`, and stays if it `error`s.
 * Renders on native via the Box/Image forks.
 *
 * The idiomatic `.avatar`: styling is `$`-token PROPS transcribed from its retired `styled()` proof
 * (docs/tamagui-idiomatic-migration.md §4); `avatar/index.css` is deleted. `AvatarImage` stays a
 * `Prim.Image` (a pure host `<img>` passthrough — a replaced element, so it takes `style`, not
 * Tamagui style props).
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

/** `.avatar` base — relative, flex, size-8, shrink-0, overflow-hidden, rounded-full, bg-muted. */
const AVATAR_BASE = {
  position: 'relative',
  display: 'flex',
  width: '$8',
  height: '$8',
  flexShrink: 0,
  overflow: 'hidden',
  borderRadius: '$radius-full',
  backgroundColor: '$muted',
  color: '$muted-foreground',
} as const

/** `.avatar--sm` / `--lg`. `default` is a no-op: `.avatar` already carries size-8. */
const AVATAR_SIZE: Record<AvatarSize, Record<string, unknown>> = {
  default: {},
  sm: { width: '$6', height: '$6', fontSize: '$xs' },
  lg: { width: '$12', height: '$12', fontSize: '$base' },
}

function Avatar({ size = 'default', ...props }: AvatarProps) {
  const [status, setStatus] = React.useState<Status>('idle')
  return (
    <AvatarContext.Provider value={{ status, setStatus }}>
      <Prim.Box {...AVATAR_BASE} {...AVATAR_SIZE[size]} {...(props as Record<string, unknown>)} />
    </AvatarContext.Provider>
  )
}

/** `.avatar__image` — h-full, w-full, object-cover. A host `<img>`, so styled via `style`. */
function AvatarImage({ style, onLoad, onError, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { status, setStatus } = React.useContext(AvatarContext)
  // Hidden (but still fetching) until the image successfully loads — same visible result as Radix.
  return (
    <Prim.Image
      style={{
        height: '100%',
        width: '100%',
        objectFit: 'cover',
        ...(status === 'loaded' ? undefined : { display: 'none' }),
        ...style,
      }}
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

/** `.avatar__fallback` — flex, h-full, w-full, items-center, justify-center, text-sm, font-medium. */
const AVATAR_FALLBACK = {
  display: 'flex',
  height: '100%',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '$sm',
  fontWeight: '$medium',
} as const

function AvatarFallback({ colorKey, style, ...props }: AvatarFallbackProps) {
  const { status } = React.useContext(AvatarContext)
  if (status === 'loaded') return null
  const tint = colorKey
    ? (() => {
        const c = spectrumColor(colorKey)
        return { backgroundColor: `color-mix(in srgb, ${c} 22%, transparent)`, color: c, ...style }
      })()
    : style
  return <Prim.Box {...AVATAR_FALLBACK} style={tint} {...(props as Record<string, unknown>)} />
}

export { Avatar, AvatarImage, AvatarFallback }

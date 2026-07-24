/**
 * avatar.styled.tsx — P2 leaf conversion of the `.avatar` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/content/avatar/index.css —
 * the `.avatar` base + `.avatar--sm`/`--lg` and the `.avatar__image`/`__fallback` parts — into
 * idiomatic Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors and SPIKE-B scales.
 *
 * The load-state behaviour (fallback shows until the image `load`s, spectrum tint) is unchanged from
 * the shipped className Avatar (index.tsx) — only the styling moves to `styled()`. Lands alongside it;
 * avatar-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'
import { spectrumColor } from '../../../lib/spectrum'

/**
 * `.avatar` base (relative, flex, size-8, shrink-0, overflow-hidden, rounded-full, bg-muted,
 * text-muted-foreground) + the `size` variant (`.avatar--sm` = size-6/text-xs, `--lg` = size-12/text-base).
 */
export const AvatarFrame = styled(View, {
  name: 'Avatar',
  position: 'relative',
  display: 'flex',
  width: '$8',
  height: '$8',
  flexShrink: 0,
  overflow: 'hidden',
  borderRadius: '$radius-full',
  backgroundColor: '$muted',
  color: '$muted-foreground',

  variants: {
    size: {
      default: {}, // .avatar already carries size-8
      sm: { width: '$6', height: '$6', fontSize: '$xs' },
      lg: { width: '$12', height: '$12', fontSize: '$base' },
    },
  } as const,

  defaultVariants: { size: 'default' },
})

/** `.avatar__image` — h-full, w-full, object-cover. */
export const AvatarImageFrame = styled(View, {
  name: 'AvatarImage',
  tag: 'img',
  height: '100%',
  width: '100%',
  objectFit: 'cover',
})

/** `.avatar__fallback` — flex, h-full, w-full, items-center, justify-center, text-sm, font-medium. */
export const AvatarFallbackFrame = styled(View, {
  name: 'AvatarFallback',
  display: 'flex',
  height: '100%',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '$sm',
  fontWeight: '$medium',
})

export type AvatarSize = 'default' | 'sm' | 'lg'
type Status = 'idle' | 'loaded' | 'error'
const AvatarContext = React.createContext<{ status: Status; setStatus: (s: Status) => void }>({
  status: 'idle',
  setStatus: () => {},
})

const Frame = AvatarFrame as unknown as React.ComponentType<any>
const ImageFrame = AvatarImageFrame as unknown as React.ComponentType<any>
const FallbackFrame = AvatarFallbackFrame as unknown as React.ComponentType<any>

export interface StyledAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: AvatarSize
}

/** Idiomatic Avatar — same Root/Image/Fallback API + load-state behaviour as the className Avatar. */
export function StyledAvatar({ size = 'default', ...props }: StyledAvatarProps) {
  const [status, setStatus] = React.useState<Status>('idle')
  return (
    <AvatarContext.Provider value={{ status, setStatus }}>
      <Frame size={size} {...props} />
    </AvatarContext.Provider>
  )
}

export function StyledAvatarImage({ onLoad, onError, style, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const { status, setStatus } = React.useContext(AvatarContext)
  return (
    <ImageFrame
      style={status === 'loaded' ? style : { display: 'none', ...(style as object) }}
      onLoad={(e: React.SyntheticEvent<HTMLImageElement>) => { setStatus('loaded'); onLoad?.(e) }}
      onError={(e: React.SyntheticEvent<HTMLImageElement>) => { setStatus('error'); onError?.(e) }}
      {...props}
    />
  )
}

export interface StyledAvatarFallbackProps extends React.HTMLAttributes<HTMLDivElement> {
  colorKey?: string
}

export function StyledAvatarFallback({ colorKey, style, ...props }: StyledAvatarFallbackProps) {
  const { status } = React.useContext(AvatarContext)
  if (status === 'loaded') return null
  const tint = colorKey
    ? (() => {
        const c = spectrumColor(colorKey)
        return { backgroundColor: `color-mix(in srgb, ${c} 22%, transparent)`, color: c, ...(style as object) }
      })()
    : style
  return <FallbackFrame style={tint} {...props} />
}

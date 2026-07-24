/**
 * caption.styled.tsx — P2 leaf conversion of the `.caption` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/typography/caption/index.css
 * — the `.caption` base + `.caption--muted` — into ONE `styled(Text, { variants })` using the SPIKE-A1
 * var-backed `$` colors and SPIKE-B scales.
 *
 * `leading-snug` has no named lineHeight token (the scale is keyed by font-size), so its Tailwind
 * multiplier (1.375) is emitted as a unitless string — Tamagui web passes it through verbatim.
 *
 * Lands alongside the shipped className Caption (index.tsx); caption-styled.test.tsx pins it.
 */
import * as React from 'react'
import { styled, Text } from '../../../theme/tamagui-web.config'

/** `.caption` base (text-xs, text-muted-foreground, leading-snug) + the `muted` variant. */
export const CaptionFrame = styled(Text, {
  name: 'Caption',
  tag: 'span',
  fontSize: '$xs',
  color: '$muted-foreground',
  lineHeight: '1.375' as unknown as number, // leading-snug (unitless multiplier)

  variants: {
    muted: {
      // .caption--muted — text-muted-foreground/70 (alpha via web color-mix)
      true: { color: 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)' },
    },
  } as const,
})

export interface StyledCaptionProps extends React.ComponentProps<'span'> {
  muted?: boolean
}

const Frame = CaptionFrame as unknown as React.ComponentType<any>

/** Idiomatic Caption — same public API as the shipped className Caption (`muted`). */
export function StyledCaption({ muted, ...props }: StyledCaptionProps) {
  return <Frame muted={muted} {...props} />
}

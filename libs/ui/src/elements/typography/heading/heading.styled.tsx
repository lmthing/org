/**
 * heading.styled.tsx — P2 leaf conversion of the `.heading-*` blocks
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/typography/heading/index.css
 * — `.heading-1..4` + `.heading--muted` — into ONE `styled(Text, { variants })` using the SPIKE-A1
 * var-backed `$` colors and SPIKE-B font scales (size + letterSpacing).
 *
 * The four numbered blocks share font-semibold + tracking-tight + text-foreground; only the font size
 * differs, so they collapse into a single `level` variant. Lands alongside the shipped className
 * Heading (index.tsx); heading-styled.test.tsx pins it.
 */
import * as React from 'react'
import { styled, Text } from '../../../theme/tamagui-web.config'

/**
 * `.heading-*` base (font-semibold, tracking-tight, text-foreground) + the `level` variant (font size
 * per level: 1=3xl, 2=2xl, 3=xl, 4=base) + the `muted` variant.
 */
export const HeadingFrame = styled(Text, {
  name: 'Heading',
  fontWeight: '$semibold',
  letterSpacing: '$tight',
  color: '$foreground',

  variants: {
    level: {
      1: { fontSize: '$3xl' },
      2: { fontSize: '$2xl' },
      3: { fontSize: '$xl' },
      4: { fontSize: '$base' },
    },
    muted: {
      true: { color: '$muted-foreground' },
    },
  } as const,

  defaultVariants: { level: 2 },
})

export type HeadingLevel = 1 | 2 | 3 | 4

export interface StyledHeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel
  muted?: boolean
}

const Frame = HeadingFrame as unknown as React.ComponentType<any>

/** Idiomatic Heading — same public API as the shipped className Heading (`level`/`muted`). */
export function StyledHeading({ level = 2, muted, children, ...props }: StyledHeadingProps) {
  const tag = `h${level}` as const
  return (
    <Frame tag={tag} level={level} muted={muted} {...props}>
      {children}
    </Frame>
  )
}

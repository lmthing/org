/**
 * card.styled.tsx — P2 leaf conversion of the `.card` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/content/card/index.css —
 * the `.card` base + `.card--interactive` and the `.card__header`/`__body`/`__footer` parts — into
 * idiomatic Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors and SPIKE-B scales.
 *
 * Lands alongside the shipped className Card (index.tsx); card-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.card` base (rounded-lg, border-border, bg-card, text-card-foreground, shadow-sm) + the
 * `interactive` variant (hover:shadow-md, cursor-pointer; `transition-shadow` awaits the animation
 * driver, §5/P4).
 */
export const CardFrame = styled(View, {
  name: 'Card',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$card',
  color: '$card-foreground',
  // shadow-sm — single-layer approximation (harness reconciles pixels). Shadow black matches the
  // codebase's CSS convention (opaque-black-with-alpha), theme-independent.
  shadowColor: 'rgba(0,0,0,0.05)',
  shadowOffset: { width: 0, height: 1 },
  shadowRadius: 2,

  variants: {
    interactive: {
      true: {
        cursor: 'pointer',
        // hover:shadow-md ≈ 0 4px 6px rgb(0 0 0 / .1)
        hoverStyle: {
          shadowColor: 'rgba(0,0,0,0.1)',
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 6,
        },
      },
    },
  } as const,
})

/** `.card__header` — flex, flex-col, gap-1.5, p-4, pb-0. */
export const CardHeaderFrame = styled(View, {
  name: 'CardHeader',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1.5',
  padding: '$4',
  paddingBottom: 0,
})

/** `.card__body` — p-4. */
export const CardBodyFrame = styled(View, {
  name: 'CardBody',
  padding: '$4',
})

/** `.card__footer` — flex, items-center, p-4, pt-0. */
export const CardFooterFrame = styled(View, {
  name: 'CardFooter',
  display: 'flex',
  alignItems: 'center',
  padding: '$4',
  paddingTop: 0,
})

export interface StyledCardProps extends React.ComponentProps<'div'> {
  interactive?: boolean
}

const Frame = CardFrame as unknown as React.ComponentType<any>
const Header = CardHeaderFrame as unknown as React.ComponentType<any>
const Body = CardBodyFrame as unknown as React.ComponentType<any>
const Footer = CardFooterFrame as unknown as React.ComponentType<any>

/** Idiomatic Card family — same public API as the shipped className Card (`interactive`). */
export function StyledCard({ interactive, ...props }: StyledCardProps) {
  return <Frame interactive={interactive} {...props} />
}
export const StyledCardHeader = (props: React.ComponentProps<'div'>) => <Header {...props} />
export const StyledCardBody = (props: React.ComponentProps<'div'>) => <Body {...props} />
export const StyledCardFooter = (props: React.ComponentProps<'div'>) => <Footer {...props} />
